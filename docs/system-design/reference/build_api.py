#!/usr/bin/env python3
"""Build source-pinned OpenAPI references without changing the service contracts."""
import argparse
import copy
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent


def ref(name): return {'$ref': '#/components/schemas/' + name}
def array(items): return {'type': 'array', 'items': items}
def obj(properties, required=None, strict=True):
    value = {'type':'object', 'properties':properties, 'required':list(properties) if required is None else required}
    if strict: value['additionalProperties'] = False
    return value
def string(description=None): return dict(type='string', **({'description':description} if description else {}))
def nullable(kind): return {'type':[kind,'null']}
def response(description, schema, media='application/json'):
    return {'description':description, 'content':{media:{'schema':schema}}}
def parameter(name, schema, where='query', required=False, description=None):
    return dict(name=name, **{'in':where}, required=required, schema=schema,
                **({'description':description} if description else {}))


def specifications():
    sources = json.loads((ROOT/'sources.json').read_text())
    routes = json.loads((ROOT/'routes.json').read_text())
    requests = json.loads((ROOT/'schemas/pixoo-requests.json').read_text())
    counter = {'type':'integer','minimum':0,'maximum':9007199254740991}
    boolean = {'type':'boolean'}
    number = {'type':'number'}
    # These response outlines follow the source interfaces. Opaque persisted
    # error details are explicitly identified, rather than guessed.
    extra = {
        'MediaSource':obj({'format':{'enum':['png','jpeg','gif']},'width':counter,'height':counter,'frameCount':counter,'delaysMs':array(nullable('number')),'durationMs':nullable('number')}),
        'MediaProfile':obj({'name':string(),'evidence':{'enum':['provisional-simulator','observed-device']},'reference':string(),'maxFrames':counter,'minDelayMs':counter,'maxDelayMs':counter,'uniformTiming':boolean}),
        'Asset':obj({'id':ref('apiId'),'name':string(),'contentHash':ref('apiHash'),'source':ref('MediaSource'),'createdAt':string()}),
        'Rendition':obj({'id':ref('apiHash'),'sourceHash':ref('apiHash'),'renderer':string(),'transform':ref('transformRequest'),'profile':ref('MediaProfile'),'source':ref('MediaSource'),'warnings':array(obj({'frame':counter,'code':{'enum':['missing-delay','zero-delay']},'effectiveDelayMs':{'const':100}})),'effectiveDurationMs':nullable('number'),'frames':array(obj({'index':counter,'delayMs':nullable('number'),'rgbHash':ref('apiHash'),'previewHash':ref('apiHash')}))}),
        'PlaylistItem':obj({'id':ref('apiId'),'renditionId':ref('apiHash'),'playback':ref('playbackPolicy')}),
        'Playlist':obj({'id':ref('apiId'),'name':string(),'revision':ref('apiRevision'),'repeat':boolean,'shuffle':boolean,'createdAt':string(),'updatedAt':string(),'items':array(ref('PlaylistItem'))}),
        'PlayerState':obj({'state':{'enum':['idle','loading','playing','paused','reconnecting','error']},'intent':{'enum':['active','paused','stopped']},'availability':{'enum':['unknown','available','offline']},'generation':counter,'sessionId':nullable('string'),'playlistId':nullable('string'),'playlistRevision':nullable('number'),'itemId':nullable('string'),'estimatedReadyAtMs':nullable('number'),'dwellDeadlineMs':nullable('number'),'timing':{'const':'estimated'},'requestedScreenOn':boolean,'lastError':{'anyOf':[{'type':'null'},obj({'code':{'type':'string','minLength':1,'maxLength':64},'itemId':ref('apiId'),'priorEffects':{'enum':['none','possible']}},required=['code'])]}}),
        'SessionSource':{'oneOf':[obj({'kind':{'const':'playlist'}}),obj({'kind':{'const':'media'},'assetId':ref('apiId'),'renditionId':ref('apiHash')})]},
        'PlayerSnapshot':obj({'sampledAtMs':number,'serverId':string(),'nextRequestId':ref('requestIdentity'),'player':ref('PlayerState'),'session':{'anyOf':[{'type':'null'},obj({'id':ref('apiId'),'playlist':ref('Playlist'),'source':ref('SessionSource')},required=['id','playlist'])]}}),
        'ProbeResult':{'oneOf':[obj({'mode':{'const':'simulator'},'available':{'const':True},'connected':{'const':False}}),obj({'mode':{'const':'device'},'available':{'const':True},'connected':{'const':True},'channel':number,'brightness':number,'screenOn':boolean},required=['mode','available','connected','channel'])]},
        'DeviceStatus':obj({'configuration':{'anyOf':[{'type':'null'},ref('deviceConfiguration')]},'activeConfiguration':{'anyOf':[{'type':'null'},ref('deviceConfiguration')]},'restartRequired':boolean,'mode':{'enum':['simulator','device']},'connected':nullable('boolean'),'availability':{'enum':['unknown','available','offline']},'activeProfile':ref('MediaProfile'),'profiles':array(ref('MediaProfile'))}),
    }
    pixoo_details = {
        ('get','/api/health'):('Health','Read current runtime health',None,ref('healthSchema')),
        ('get','/api/diagnostics'):('Health','Read bounded runtime diagnostics',None,ref('diagnosticsSchema')),
        ('get','/api/assets'):('Media','List and search assets',None,obj({'items':array(ref('Asset')),'total':counter,'offset':counter,'limit':counter})),
        ('post','/api/assets'):('Media','Import one media file','upload',obj({'asset':ref('Asset'),'rendition':ref('Rendition')})),
        ('get','/api/assets/{id}'):('Media','Read an asset and its renditions',None,obj({'asset':ref('Asset'),'renditions':array(ref('Rendition'))})),
        ('post','/api/assets/{id}/renditions'):('Media','Render an asset','renditionRequest',obj({'status':{'const':'complete'},'asset':ref('Asset'),'rendition':ref('Rendition')})),
        ('delete','/api/assets/{id}'):('Media','Delete an unreferenced asset',None,None),
        ('get','/api/renditions/{id}'):('Media','Read an immutable rendition manifest',None,ref('Rendition')),
        ('get','/api/renditions/{id}/frames/{index}.png'):('Media','Read a preview frame',None,{'type':'string','format':'binary'}),
        ('get','/api/playlists'):('Playlists','List playlists',None,array(ref('Playlist'))),
        ('post','/api/playlists'):('Playlists','Create a playlist','playlistCreate',ref('Playlist')),
        ('get','/api/playlists/{id}'):('Playlists','Read a playlist',None,ref('Playlist')),
        ('patch','/api/playlists/{id}'):('Playlists','Rename a playlist','playlistRename',ref('Playlist')),
        ('patch','/api/playlists/{id}/options'):('Playlists','Change repeat or shuffle','playlistOptions',ref('Playlist')),
        ('put','/api/playlists/{id}/items'):('Playlists','Replace ordered items','playlistItems',ref('Playlist')),
        ('put','/api/playlists/{id}/order'):('Playlists','Reorder the exact current item set','playlistOrder',ref('Playlist')),
        ('post','/api/playlists/{id}/duplicate'):('Playlists','Duplicate a playlist with a new name','playlistRename',ref('Playlist')),
        ('delete','/api/playlists/{id}'):('Playlists','Delete a playlist at a known revision','expectedRevision',None),
        ('get','/api/player'):('Player','Read player state and next request ID',None,ref('PlayerSnapshot')),
        ('post','/api/player/commands'):('Player','Submit a player command','playerCommand',ref('PlayerSnapshot')),
        ('get','/api/events'):('Player','Subscribe to state and resync events',None,string('SSE state/resync events contain the PlayerSnapshot JSON. Event IDs use a separate epoch/sequence from command IDs.')),
        ('get','/api/device'):('Device','Read saved device configuration',None,ref('DeviceStatus')),
        ('put','/api/device'):('Device','Save device configuration','deviceConfiguration',ref('DeviceStatus')),
        ('post','/api/device/probe'):('Device','Probe the selected adapter','emptyRequest',ref('ProbeResult')),
        ('patch','/api/device/display'):('Device','Set selected adapter brightness or screen power','displayCommand',ref('PlayerSnapshot')),
    }
    shared = json.loads((ROOT/'schemas/controller-contract.json').read_text())['$defs']
    shared = json.loads(json.dumps(shared).replace('#/$defs/', '#/components/schemas/'))
    shared['HttpFailure'] = obj({'failure':ref('failure')})
    titles = {'pixoo':'Pixoo HTTP API','nanoleaf-controller':'Nanoleaf controller API','nanoleaf-map':'Nanoleaf wall-map API'}
    intros = {
        'pixoo':'25 explicit source routes. Default startup uses a simulator; explicitly selected device mode can contact a physical display through the sole owning queue. Sessions restore paused. Browser requests must have the service origin; native mutations require X-Pixoo-Request: 1. Optional deployment authentication is application-defined. The optional MCP transport is documented separately from these REST/SSE operations. Media uploads allow one file up to 10 MiB; JSON is limited to 64 KiB. Never replace a request ID automatically after an uncertain response. Fields generated from Zod retain structural constraints; service refinements and current domain behavior remain authoritative.',
        'nanoleaf-controller':'Four native machine routes. Every request requires the configured machine bearer credential, exact loopback Host and allowed origin. Only Work, Quiet and Free mode changes are supported. Other shared command types return unsupported-capability. Obtain controller/device IDs, nextRequestId, configurationRevision and generation from a current snapshot. Queued/sent receipts do not establish visible light output. Reads are side-effect-free and the feed is bounded polling, not SSE.',
        'nanoleaf-map':'Eight wall-map operations. These belong to the existing browser UI, with a per-page X-Wall-Token and exact same-origin checks for writes. A machine bearer token cannot replace the wall token. GET /api/state may refresh host metadata or geometry and launch the owning worker after a change; it is not the machine API safe snapshot. No private runtime values are included in this reference.',
    }
    specifications = {}
    for service, title in titles.items():
        pin = sources['pins']['pixoo' if service=='pixoo' else 'nanoleaf']
        spec = {'openapi':'3.1.0','info':{'title':title,'version':pin['revision'][:8],
            'description':intros[service]+'\n\nThis is a source-pinned reference, not a new deployed service. The port 0 server is a documentation placeholder. Replace it with the configured listener when importing into a native API client.'},
            'servers':[{'url':'http://127.0.0.1:{port}','description':'Replace port 0 with the configured local listener; no running endpoint selected','variables':{'port':{'default':'0'}}}],
            'paths':{},'components':{'schemas':copy.deepcopy({**requests,**extra} if service=='pixoo' else shared if service=='nanoleaf-controller' else {})},
            'x-source-repository':pin['repository'],'x-source-revision':pin['revision'],
            'x-reference-mode':'offline-reference; live browser testing requires same-origin service integration'}
        if service=='nanoleaf-controller':
            spec['components']['securitySchemes']={'machineBearer':{'type':'http','scheme':'bearer','description':'Controller machine credential with read/control scope as required. Not a Nanoleaf device token.'}}
            spec['security']=[{'machineBearer':[]}]
        for route in [r for r in routes if r['service']==service]:
            method, path = route['method'], route['path']
            source = sources['files'][('pixoo' if service=='pixoo' else 'nanoleaf')+'/'+route['file']]
            operation = {'operationId':service.replace('-','_')+'_'+method+'_'+re.sub(r'[^a-z0-9]+','_',path.lower()).strip('_'),
                'parameters':[],'responses':{},'externalDocs':{'description':'Owning source handler','url':source['url']+'#L'+str(route['line'])}}
            media = 'application/json'
            success = '200'
            if service=='pixoo':
                tag, summary, body, result = pixoo_details[method,path]
                operation.update(tags=[tag],summary=summary)
                for name in re.findall(r'\{(\w+)\}',path):
                    shape = {'type':'integer','minimum':0,'maximum':999} if name=='index' else ref('apiHash' if path.startswith('/api/renditions') else 'apiId')
                    operation['parameters'].append(parameter(name,shape,'path',True))
                if path=='/api/assets' and method=='get':
                    operation['parameters'] += [parameter('offset',{'type':'integer','minimum':0,'maximum':1000000,'default':0}),parameter('limit',{'type':'integer','minimum':1,'maximum':100,'default':25}),parameter('q',{'type':'string','maxLength':120,'default':''})]
                if method not in ('get','head'):
                    operation['parameters'].append(parameter('X-Pixoo-Request',{'type':'string','const':'1'},'header',False,'Required for native mutations without Origin. Browser requests must use the owning service origin.'))
                if body:
                    body_schema = obj({'file':{'type':'string','format':'binary'}}) if body=='upload' else ref(body)
                    operation['requestBody']={'required':body!='emptyRequest','content':{'multipart/form-data' if body=='upload' else 'application/json':{'schema':body_schema}}}
                if method=='post' and path in ['/api/assets','/api/playlists','/api/playlists/{id}/duplicate']: success='201'
                if method=='delete': success='204'
                if path.endswith('.png'): media='image/png'
                if path=='/api/events':
                    media='text/event-stream'
                    operation['parameters'].append(parameter('Last-Event-ID',string(),'header',False,'Use the stream cursor. Invalid/expired/foreign cursors receive a full resync.'))
                error = ref('apiErrorSchema')
            elif service=='nanoleaf-controller':
                operation['tags']=['Controller']
                summary, result = {
                    '/controller/v1/devices':('Discover the configured authorized device',obj({'apiVersion':{'const':'1.0'},'devices':array(ref('snapshot'))})),
                    '/controller/v1/snapshot':('Read a side-effect-free controller snapshot',ref('snapshot')),
                    '/controller/v1/feed':('Poll the bounded change/resync feed',array(ref('feed'))),
                    '/controller/v1/commands':('Request a supported mode change',ref('receipt')),
                }[path]
                operation['summary']=summary
                if path.endswith(('snapshot','feed')): operation['parameters'].append(parameter('deviceId',ref('id'),required=True))
                if path.endswith('feed'): operation['parameters'] += [parameter('epoch',string()),parameter('sequence',{'type':'integer','description':'Cursor sequence; invalid, missing or expired cursors resynchronize.'})]
                if method=='post':
                    operation['requestBody']={'required':True,'content':{'application/json':{'schema':ref('request')}}}
                    operation['responses']['202']=response('Admitted queued work; not physical completion.',ref('receipt'))
                error = ref('HttpFailure')
            else:
                operation['tags']=['Wall map']
                operation['summary']={
                    '/health':'Read map service identity','/api/state':'Read wall state and refresh owning metadata',
                    '/api/mode':'Choose Work, Quiet or Free','/api/settings':'Change wall display preferences',
                    '/api/assign':'Assign Lines to projects','/api/project':'Change project color',
                    '/api/task':'Change a task project','/api/locate':'Locate a Line',
                }[path]
                result = obj({'ok':{'const':True}})
                error = obj({'error':string()})
                if method=='get':
                    result = obj({'service':{'const':'codex-nanoleaf-map'},'instance':nullable('string')}) if path=='/health' else {'type':'object','description':'Wall settings, mode/pending/error, projects, Lines, tasks, now, and connector/geometry status. Includes private host metadata at runtime. See the source handler for nested UI fields.'}
                else:
                    bodies={
                        '/api/mode':obj({'mode':{'enum':['work','quiet','free']}},strict=False),
                        '/api/settings':dict(type='object',minProperties=1,additionalProperties=False,properties={'style':{'enum':['classic','project']},'coverage':{'enum':['whole','status']},'rotation':{'enum':[0,90,180,270,False]},'flip_x':{'enum':[0,1,False,True]},'flip_y':{'enum':[0,1,False,True]}}),
                        '/api/assign':obj({'lines':{'type':'object','minProperties':1,'additionalProperties':dict(type='object',minProperties=1,additionalProperties=False,properties={'project':nullable('string'),'signature':{'type':'integer','enum':[0,1]}})}},strict=False),
                        '/api/project':obj({'id':string(),'color':{'type':'string','pattern':'^#[0-9a-fA-F]{6}$'}},strict=False),
                        '/api/task':obj({'id':string(),'project':nullable('string')},required=['id'],strict=False),
                        '/api/locate':obj({'line':string('An existing Line ID. Free mode rejects locate.')},strict=False),
                    }
                    operation['parameters'] += [parameter('Origin',string('Exact http://127.0.0.1:<wall-port> origin.'),'header',True),parameter('X-Wall-Token',string('Ephemeral page token supplied by the owning wall UI.'),'header',True)]
                    operation['requestBody']={'required':True,'content':{'application/json':{'schema':bodies[path]}}}
            operation['responses'][success] = {'description':'Completed without a response body.'} if result is None else response('Owning service response.',result,media)
            operation['responses']['default']=response('Service error. Authentication, validation, state conflicts and capacity remain enforced by the owner.',error)
            if service=='nanoleaf-controller' and method=='post':
                operation['responses']['default']=response('Before admission: bounded failure. After reservation: retained receipt, including semantic or launch failure.',{'oneOf':[ref('HttpFailure'),ref('receipt')]})
            spec['paths'].setdefault(path,{})[method]=operation
        specifications[service]=spec
    return specifications


def build(check=False):
    for service, spec in specifications().items():
        output=ROOT/'openapi'/f'{service}.json'
        content=json.dumps(spec,indent=2,ensure_ascii=False)+'\n'
        if check:
            assert output.read_text(encoding='utf-8')==content, f'OpenAPI drift: {service}'
        else:
            output.parent.mkdir(exist_ok=True)
            output.write_text(content,encoding='utf-8')
    print('Verified 3 OpenAPI references.' if check else 'Built 3 OpenAPI references.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true')
    build(parser.parse_args().check)
