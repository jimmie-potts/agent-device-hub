"""Project metadata, persistent wall preferences, and task placement."""
import colorsys
import json
import math
import os
from pathlib import Path
import posixpath
import re
import sqlite3


def init(db):
    # Keep schema creation inside the caller's initialization transaction.
    for statement in (
        'CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,name TEXT,color TEXT,roots TEXT)',
        'CREATE TABLE IF NOT EXISTS task_info (session TEXT PRIMARY KEY,title TEXT,cwd TEXT,project TEXT,manual_project TEXT,turn TEXT,started REAL)',
        'CREATE TABLE IF NOT EXISTS line_prefs (line_id TEXT PRIMARY KEY,project TEXT,signature INTEGER DEFAULT 0)',
        'CREATE TABLE IF NOT EXISTS map_settings (id INTEGER PRIMARY KEY,style TEXT,coverage TEXT,rotation INTEGER,flip_x INTEGER,flip_y INTEGER)',
        'CREATE TABLE IF NOT EXISTS map_pending (id INTEGER PRIMARY KEY,payload TEXT)',
        'CREATE TABLE IF NOT EXISTS locate (id INTEGER PRIMARY KEY,line_id TEXT,started REAL)',
        "INSERT OR IGNORE INTO map_settings VALUES (1,'classic','whole',0,0,0)",
    ):
        db.execute(statement)


def settings(db):
    row=db.execute('SELECT style,coverage,rotation,flip_x,flip_y FROM map_settings WHERE id=1').fetchone()
    return dict(zip(('style','coverage','rotation','flip_x','flip_y'),row))


def line_id(pair):
    return ':'.join(map(str,sorted(pair)))


def normalize(path):
    if not isinstance(path,str): return ''
    path=(path or '').replace('\\','/').rstrip('/')
    lower=path.lower()
    if lower.startswith('//wsl$/') or lower.startswith('//wsl.localhost/'):
        pieces=path.split('/',4)
        path='/' + pieces[4] if len(pieces)>4 else path
    path=posixpath.normpath(path) if path else ''
    if re.match(r'^/mnt/[a-zA-Z]/',path):
        return path[5].lower()+':/'+path[7:].lower()
    if re.match(r'^[a-zA-Z]:/',path):
        return path.lower()
    return path


def default_color(project_id):
    # Stable colors across catalog reorderings; users can replace every suggestion.
    hue=sum((i+1)*ord(ch) for i,ch in enumerate(project_id))%360
    return '#'+''.join(f'{round(c*255):02x}' for c in colorsys.hsv_to_rgb(hue/360,.62,.95))


def record_event(db,event,instant):
    session=event.get('session_id')
    row=db.execute('SELECT turn FROM sessions WHERE id=?',(session,)).fetchone()
    if not row: return False
    previous=db.execute('SELECT title,cwd,project,manual_project,turn,started FROM task_info WHERE session=?',(session,)).fetchone()
    title,cwd,project,manual,turn,started=previous or ('','',None,None,row[0],None)
    if turn!=row[0]: started=None
    incoming=event.get('cwd')
    if isinstance(incoming,str): cwd=incoming
    if event.get('hook_event_name')=='UserPromptSubmit' and (not previous or turn!=row[0] or started is None):
        started=instant
    value=(title,cwd,project,manual,row[0],started)
    if value==previous: return False
    db.execute('INSERT OR REPLACE INTO task_info VALUES (?,?,?,?,?,?,?)',(session,*value))
    return True


class Metadata:
    def __init__(self,directory,config):
        custom=config.get('metadata_path')
        if custom:
            self.path=Path(custom)
        elif os.name=='nt' and directory.name=='CodexNanoleaf':
            self.path=Path(os.environ['USERPROFILE'])/'.codex'/'.codex-global-state.json'
        else:
            self.path=None
        self.index=Path(config['title_index_path']) if config.get('title_index_path') else self.path.with_name('session_index.jsonl') if self.path else None
        self.stamps={}; self.data={}; self.titles={}

    def refresh(self):
        for path in (self.path,self.index):
            if not path: continue
            try:
                stat=path.stat(); stamp=(stat.st_mtime_ns,stat.st_size)
                if self.stamps.get(path)==stamp: continue
                if path==self.path:
                    raw=json.loads(path.read_text(encoding='utf-8-sig'))
                    keys=('local-projects','thread-project-assignments','thread-workspace-root-hints')
                    if not isinstance(raw,dict) or any(not isinstance(raw.get(k),dict) for k in keys): continue
                    self.data={k:raw[k] for k in keys}
                else:
                    titles={}
                    with path.open(encoding='utf-8-sig') as stream:
                        for line in stream:
                            try:
                                item=json.loads(line)
                                if isinstance(item,dict) and isinstance(item.get('id'),str) and isinstance(item.get('thread_name'),str):
                                    titles[item['id']]=item['thread_name']
                            except (ValueError,TypeError): continue
                    self.titles.update(titles)
                self.stamps[path]=stamp
            except (OSError,ValueError,TypeError): pass

    def sync(self,db):
        before=db.total_changes
        for pid,p in self.data.get('local-projects',{}).items():
            if not isinstance(p,dict) or not isinstance(p.get('name'),str): continue
            roots=p.get('rootPaths',[])
            if not isinstance(roots,list) or any(not isinstance(r,str) for r in roots): continue
            encoded=json.dumps(roots)
            old=db.execute('SELECT name,roots FROM projects WHERE id=?',(pid,)).fetchone()
            if old!=(p['name'],encoded):
                db.execute('INSERT INTO projects VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,roots=excluded.roots',
                           (pid,p['name'],default_color(pid),encoded))
        projects={p:(name,json.loads(roots)) for p,name,roots in db.execute('SELECT id,name,roots FROM projects')}
        assignments=self.data.get('thread-project-assignments',{})
        hints=self.data.get('thread-workspace-root-hints',{})
        for session,turn in db.execute('SELECT id,turn FROM sessions').fetchall():
            previous=db.execute('SELECT title,cwd,project,manual_project,turn,started FROM task_info WHERE session=?',(session,)).fetchone()
            title,cwd,project,manual,old_turn,started=previous or ('','',None,None,turn,None)
            title=self.titles.get(session,title)
            assignment=assignments.get(session,{})
            explicit=assignment.get('projectId') if isinstance(assignment,dict) else None
            if isinstance(explicit,str) and explicit in projects: project=explicit
            else:
                candidate=normalize(hints.get(session) or cwd)
                matches=[(len(root),pid) for pid,(_,roots) in projects.items() for r in roots
                         for root in [normalize(r)] if root and (candidate==root or candidate.startswith(root+'/'))]
                if matches: project=max(matches)[1]
            value=(title,cwd,project,manual,turn,started if old_turn==turn else None)
            if value!=previous:
                db.execute('INSERT OR REPLACE INTO task_info VALUES (?,?,?,?,?,?,?)',(session,*value))
        return db.total_changes!=before


def task_projects(db):
    return {s:manual or project for s,project,manual in db.execute('SELECT session,project,manual_project FROM task_info')}


def owners(db,config):
    prefs={key:(project,signature) for key,project,signature in db.execute('SELECT * FROM line_prefs')}
    return [prefs.get(line_id(pair),(None,0)) for pair in config['line_groups']]


def allocate(db,config,rows,reserved):
    assignments=dict(db.execute('SELECT session,slot FROM slots'))
    active={r[0] for r in rows}; projects=task_projects(db); prefs=owners(db,config)
    style=settings(db)['style']
    def valid(session,slot):
        return 0<=slot<len(prefs) and (style=='classic' or prefs[slot][0] in (None,projects.get(session)))
    for session,slot in list(assignments.items()):
        if not valid(session,slot) and slot not in reserved:
            db.execute('DELETE FROM slots WHERE session=?',(session,)); del assignments[session]
    for session,_,_ in rows:
        if session in assignments: continue
        candidates=[slot for slot in range(len(prefs)) if slot not in reserved and valid(session,slot)]
        if style=='project': candidates.sort(key=lambda i:prefs[i][0] is None)
        chosen=None
        for slot in candidates:
            occupant=next((s for s,n in assignments.items() if n==slot),None)
            if occupant is None or occupant not in active:
                chosen=slot
                if occupant is not None:
                    db.execute('DELETE FROM slots WHERE session=?',(occupant,)); del assignments[occupant]
                break
        if chosen is not None:
            db.execute('INSERT INTO slots VALUES (?,?)',(session,chosen)); assignments[session]=chosen
    return assignments


def render_config(db,config,snapshot):
    prefs=owners(db,config); projects=task_projects(db)
    colors={pid:tuple(int(color[i:i+2],16) for i in (1,3,5)) for pid,color in db.execute('SELECT id,color FROM projects')}
    active={slot:projects.get(session) for session,slot in db.execute('SELECT session,slot FROM slots')
            if 0<=slot<len(snapshot) and snapshot[slot]}
    settings_value=settings(db)
    config['_style']=settings_value['style']; config['_coverage']=settings_value['coverage']
    config['_signatures']=[(colors.get(active.get(i) or owner),signature) for i,(owner,signature) in enumerate(prefs)]


def pending(db):
    row=db.execute('SELECT payload FROM map_pending WHERE id=1').fetchone()
    return json.loads(row[0]) if row else None


def apply_patch(db,patch):
    if patch.get('settings'):
        for key,value in patch['settings'].items():
            db.execute(f'UPDATE map_settings SET {key}=? WHERE id=1',(value,))
    for line,value in patch.get('lines',{}).items():
        current=db.execute('SELECT project,signature FROM line_prefs WHERE line_id=?',(line,)).fetchone() or (None,0)
        db.execute('INSERT OR REPLACE INTO line_prefs VALUES (?,?,?)',
                   (line,value.get('project',current[0]),value.get('signature',current[1])))
    for session,project in patch.get('tasks',{}).items():
        db.execute('UPDATE task_info SET manual_project=? WHERE session=?',(project,session))


def request_patch(db,patch,config):
    previous=pending(db) or {}
    merged={key:{**previous.get(key,{}),**patch.get(key,{})} for key in ('settings','lines','tasks')}
    merged['lines']={key:{**previous.get('lines',{}).get(key,{}),**patch.get('lines',{}).get(key,{})}
                     for key in merged['lines']}
    comet=db.execute('SELECT session,source FROM comets WHERE started IS NOT NULL').fetchone()
    defer=False
    if comet:
        session,source=comet
        source_id=line_id(config['line_groups'][source])
        defer=('style' in merged['settings'] or source_id in merged['lines'] or session in merged['tasks'])
    if defer:
        db.execute('INSERT OR REPLACE INTO map_pending VALUES (1,?)',(json.dumps(merged),))
    else:
        apply_patch(db,merged); db.execute('DELETE FROM map_pending')
    return defer


def apply_pending(db):
    change=pending(db)
    if change and not db.execute('SELECT 1 FROM comets WHERE started IS NOT NULL').fetchone():
        apply_patch(db,change); db.execute('DELETE FROM map_pending'); return True
    return False


def locate_state(db,config,instant,mode):
    if mode=='free':
        db.execute('DELETE FROM locate'); return None
    row=db.execute('SELECT line_id,started FROM locate WHERE id=1').fetchone()
    if not row: return None
    key,started=row
    if started is not None and instant>=started+1:
        db.execute('DELETE FROM locate'); return None
    if db.execute('SELECT 1 FROM comets WHERE started IS NOT NULL').fetchone(): return None
    ids=[line_id(pair) for pair in config['line_groups']]
    if key not in ids:
        db.execute('DELETE FROM locate'); return None
    if started is None:
        started=instant; db.execute('UPDATE locate SET started=? WHERE id=1',(started,))
    return {'source':ids.index(key),'started':started}


def geometry(config):
    raw=config.get('zone_geometry')
    if not raw: return []
    zones={p['panelId']:p for p in raw['positionData']}
    segments=[]
    angle=math.radians(raw.get('orientation',0))
    def rotate(x,y): return [x*math.cos(angle)-y*math.sin(angle),-(x*math.sin(angle)+y*math.cos(angle))]
    for index,pair in enumerate(config['line_groups']):
        a,b=(zones[i] for i in pair); dx=b['x']-a['x']; dy=b['y']-a['y']
        points=[rotate(a['x']-dx/2,a['y']-dy/2),rotate((a['x']+b['x'])/2,(a['y']+b['y'])/2),rotate(b['x']+dx/2,b['y']+dy/2)]
        segments.append({'id':line_id(pair),'number':index+1,'points':points})
    return segments


def validated_connector_geometry(raw, groups):
    """Return an allowlisted cache and graph, or reject unsupported geometry."""
    if not isinstance(raw,dict) or type(raw.get('version',1)) is not int or raw.get('version',1)!=1:
        raise ValueError('Unsupported connector geometry.')
    points=raw.get('positionData'); orientation=raw.get('orientation',0)
    def numeric(value):
        return type(value) in (int,float) and math.isfinite(value) and abs(value)<=1_000_000
    if not numeric(orientation) or not isinstance(points,list) or not 1<=len(points)<=1000:
        raise ValueError('Invalid connector positions.')
    clean=[]; seen=set()
    for point in points:
        if not isinstance(point,dict): raise ValueError('Invalid connector position.')
        pid=point.get('panelId'); kind=point.get('shapeType')
        if type(pid) is not int or not 0<=pid<=65535 or pid in seen:
            raise ValueError('Invalid or duplicate panel identity.')
        if type(kind) is not int or kind not in (16,18,19,20):
            raise ValueError('Unsupported connector shape.')
        if any(not numeric(point.get(key)) for key in ('x','y','o')):
            raise ValueError('Invalid connector coordinate.')
        clean.append({key:point[key] for key in ('panelId','x','y','o','shapeType')})
        seen.add(pid)
    zones={p['panelId']:p for p in clean if p['shapeType']==18}
    if not isinstance(groups,list) or not 1<=len(groups)<=300:
        raise ValueError('Invalid Line groups.')
    if any(not isinstance(pair,list) or len(pair)!=2 or any(type(pid) is not int for pid in pair) for pair in groups):
        raise ValueError('Invalid zone mapping.')
    ids=[pid for pair in groups for pid in pair]
    if len(set(ids))!=len(ids) or set(ids)!=set(zones):
        raise ValueError('Line groups must map every zone exactly once.')
    distance=lambda a,b: math.hypot(a['x']-b['x'],a['y']-b['y'])
    nodes=[]
    for point in sorted((p for p in clean if p['shapeType']!=18),key=lambda p:p['panelId']):
        matches=[n for n in nodes if distance(n,point)<2]
        if len(matches)>1: raise ValueError('Ambiguous connector housing.')
        if matches:
            matches[0]['sourceIds'].append(point['panelId'])
        else:
            nodes.append({'id':str(point['panelId']),'x':point['x'],'y':point['y'],'sourceIds':[point['panelId']]})
    if not nodes: raise ValueError('No connector positions.')
    lines=[]; used=set(); faces={}
    for index,pair in enumerate(groups):
        a,b=(zones[pid] for pid in pair); dx=b['x']-a['x']; dy=b['y']-a['y']
        length=math.hypot(dx,dy)
        if length<4: raise ValueError('Coincident light zones.')
        ends=[{'x':a['x']-dx/2,'y':a['y']-dy/2},{'x':b['x']+dx/2,'y':b['y']+dy/2}]
        joined=[]
        for end in ends:
            matches=[n for n in nodes if distance(n,end)<=max(2,length*.25)]
            if len(matches)!=1: raise ValueError('Missing or ambiguous Line end.')
            joined.append(matches[0])
        left,right=joined
        if left is right: raise ValueError('Line ends share one connector.')
        vx=right['x']-left['x']; vy=right['y']-left['y']
        delta=math.degrees(math.atan2(vy,vx)-math.atan2(dy,dx))
        if abs((delta+180)%360-180)>1:
            raise ValueError('Line zones do not align with connectors.')
        for node,other in ((left,right),(right,left)):
            heading=math.degrees(math.atan2(other['y']-node['y'],other['x']-node['x']))
            previous=faces.setdefault(node['id'],[])
            if previous:
                difference=(heading-previous[0])%360
                face=round(difference/60)%6
                if abs((difference-face*60+180)%360-180)>1 or any(round((old-previous[0])%360/60)%6==face for old in previous):
                    raise ValueError('Incompatible or duplicate connector face.')
            previous.append(heading); used.add(node['id'])
        lines.append({'id':line_id(pair),'number':index+1,'a':left['id'],'b':right['id'],'zoneIds':list(pair)})
    angle=math.radians(orientation); c=math.cos(angle); s=math.sin(angle)
    projected=[dict(n,x=n['x']*c-n['y']*s,y=-(n['x']*s+n['y']*c)) for n in nodes if n['id'] in used]
    cache={'version':1,'orientation':orientation,'positionData':clean}
    return cache,{'version':1,'nodes':projected,'lines':lines}


def connector_layout(config):
    """Project validated cached data only; never contact the controller here."""
    for raw in (config.get('connector_geometry'),config.get('zone_geometry')):
        try:
            return validated_connector_geometry(raw,config.get('line_groups'))[1]
        except (ValueError,TypeError,KeyError,OverflowError):
            continue
    return None
