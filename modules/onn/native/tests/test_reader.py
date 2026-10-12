#!/usr/bin/env python3
import json, pathlib, subprocess, shlex, unittest, os, fcntl, math, tempfile, re, socket
ROOT=pathlib.Path(__file__).resolve().parents[1]
CLASSES=pathlib.Path(os.environ["ONN_NATIVE_TEST_CLASSES"]).resolve()
class ReaderTests(unittest.TestCase):
 def raw_adb_invocation(self, scenario):
  source=(ROOT.parent/'src/reader-artifact.ts').read_text()
  invocation=re.search(r"export const READER_INVOCATION = `([^`]+)`;",source).group(1)
  invocation=invocation.replace('${READER_DEVICE_PATH}','/data/local/tmp/bunny-onn-metadata/synthetic.dex')
  reader_class=re.search(r"export const READER_CLASS = '([^']+)';",source).group(1)
  invocation=invocation.replace('${READER_CLASS}',reader_class)
  # Real reader, synthetic Android APIs. Reproduce adbd's raw stdout socket;
  # substitute only Android's app_process launcher with the host Java VM.
  launcher='app_process() { shift; exec java -Dscenario='+shlex.quote(scenario)+' -cp '+shlex.quote(str(CLASSES))+' "$@"; }; '
  parent,child=socket.socketpair()
  try:
   process=subprocess.Popen(['bash','-c',launcher+invocation],stdout=child,stderr=subprocess.PIPE)
   child.close();_,stderr=process.communicate(timeout=6)
   parent.settimeout(1);parts=[]
   while True:
    data=parent.recv(262145)
    if not data:break
    parts.append(data)
    self.assertLessEqual(sum(map(len,parts)),262144)
   return process.returncode,b''.join(parts),stderr
  finally:parent.close();child.close()
 def test_fixed_invocation_delivers_reader_result_over_raw_adb_socket(self):
  code,stdout,stderr=self.raw_adb_invocation('selected')
  self.assertEqual(code,0,'fixed invocation must supply a pipe over raw ADB socket output')
  self.assertEqual(stderr,b'')
  value=json.loads(stdout);self.validate_success(value)
  self.assertEqual(value['sessions'][0]['metadata']['title'],'Synthetic title')
 def test_fixed_invocation_preserves_reader_failure_over_raw_adb_socket(self):
  code,stdout,stderr=self.raw_adb_invocation('throw')
  self.assertEqual(code,2);self.assertEqual(stderr,b'')
  self.assertEqual(json.loads(stdout),{'schema':'onn-metadata/2.0','failure':'metadata-read-unavailable'})
 def run_reader(self, scenario="selected", args=()):
  cmd=["java", "-Dscenario="+scenario, "-cp", str(CLASSES), "OnnMetadataReader", *args]
  result=subprocess.run(["bash","-c","exec 3>&1 1>/dev/null 2>/dev/null; exec "+shlex.join(cmd)],capture_output=True,timeout=6)
  value=json.loads(result.stdout)
  self.assertLessEqual(len(result.stdout),262144)
  self.assertTrue(result.stdout.endswith(b"\n"))
  if result.returncode == 0:self.validate_success(value)
  return result.returncode, value, result
 def validate_success(self,value):
  self.assertEqual(set(value),{"schema","deviceElapsedMs","sessions"})
  self.assertEqual(value["schema"],"onn-metadata/2.0")
  def integer(number,minimum=0,maximum=9007199254740991):
   self.assertIs(type(number),int);self.assertGreaterEqual(number,minimum);self.assertLessEqual(number,maximum)
  integer(value["deviceElapsedMs"]);self.assertLessEqual(len(value["sessions"]),8)
  fields={"title","displayTitle","subtitle","artist","album","genre","description","mediaId"}
  for session in value["sessions"]:
   self.assertEqual(set(session),{"app","metadata","playback","omissions"});self.assertIn(session["app"],["youtube","stremio"])
   metadata=session["metadata"]
   if metadata is not None:
    self.assertEqual(set(metadata),fields|{"durationMs"})
    for field in fields:
     if metadata[field] is not None:
      self.assertIs(type(metadata[field]),str);self.assertLessEqual(len(metadata[field].encode("utf-8")),8192)
    if metadata["durationMs"] is not None:integer(metadata["durationMs"])
   playback=session["playback"]
   if playback is not None:
    self.assertEqual(set(playback),{"state","positionMs","speed","positionUpdatedElapsedMs"})
    integer(playback["state"],0,11);integer(playback["positionMs"],-1);integer(playback["positionUpdatedElapsedMs"])
    self.assertTrue(math.isfinite(playback["speed"]))
   self.assertLessEqual(len(session["omissions"]),16)
   self.assertEqual(len(session["omissions"]),len({(o["field"],o["reason"]) for o in session["omissions"]}))
   for omission in session["omissions"]:
    self.assertEqual(set(omission),{"field","reason"});self.assertIn(omission["field"],fields);self.assertIn(omission["reason"],["credential-redacted","oversized"])
 def test_allowlist_selected_extraction_and_startup_channel(self):
  code,value,result=self.run_reader()
  self.assertEqual(code,0)
  self.assertEqual(value["schema"],"onn-metadata/2.0")
  self.assertEqual([s["app"] for s in value["sessions"]],["youtube","stremio"])
  self.assertEqual(value["sessions"][0]["metadata"]["title"],"Synthetic title")
  self.assertEqual(value["sessions"][0]["playback"]["positionMs"],42)
  self.assertNotIn(b"STARTUP",result.stdout)
  self.assertEqual(result.stderr,b"")
 def test_empty_and_nullable_unknowns(self):
  self.assertEqual(self.run_reader("empty")[1]["sessions"],[])
  session=self.run_reader("null-content")[1]["sessions"][0]
  self.assertIsNone(session["metadata"]);self.assertIsNone(session["playback"])
  session=self.run_reader()[1]["sessions"][0]
  self.assertIsNone(session["metadata"]["mediaId"]);self.assertIsNone(session["metadata"]["durationMs"])
  self.assertEqual(self.run_reader("duration")[1]["sessions"][0]["metadata"]["durationMs"],0)
 def test_counts_and_output_bounds_refuse_whole(self):
  for case in ["too-many-controllers","too-many-sessions","total-oversize","null-list"]:
   with self.subTest(case=case): self.assert_failure(case)
  self.assertEqual(len(self.run_reader("session-limit")[1]["sessions"]),8)
 def assert_failure(self,scenario,args=()):
  code,value,result=self.run_reader(scenario,args)
  self.assertEqual(code,2)
  self.assertEqual(value,{"schema":"onn-metadata/2.0","failure":"metadata-read-unavailable"})
  self.assertNotIn(b"PRIVATE",result.stdout);self.assertEqual(result.stderr,b"")
 def test_numeric_validation(self):
  for case in ["bad-clock","unsafe-clock","bad-state","bad-position","unsafe-position","nan-speed","inf-speed","bad-update","unsafe-update","bad-duration","unsafe-duration"]:
   with self.subTest(case=case): self.assert_failure(case)
  self.assertEqual(self.run_reader("unknown-position")[1]["sessions"][0]["playback"]["positionMs"],-1)
  self.assertEqual(self.run_reader("reverse")[1]["sessions"][0]["playback"]["speed"],-1)
 def test_text_byte_bounds_unicode_and_identity(self):
  for case in ["oversized","utf8-oversized"]:
   value=self.run_reader(case)[1]["sessions"][0]
   self.assertIsNone(value["metadata"]["title"])
   self.assertEqual(value["omissions"],[{"field":"title","reason":"oversized"}])
  self.assertEqual(len(self.run_reader("boundary")[1]["sessions"][0]["metadata"]["title"]),8192)
  self.assertEqual(self.run_reader("unicode")[1]["sessions"][0]["metadata"]["title"], 'A "quote" \\ newline\n界 😀 \x01')
  self.assertEqual(self.run_reader("media-id")[1]["sessions"][0]["metadata"]["mediaId"],"https://example.test/title?id=abc")
 def test_credentials_and_ordinary_source_preservation(self):
  for case,secrets in [("credentials",["abcSecret.123","private123"]),("auth-url",["private123","private456"]),("encoded-query",["private123"]),("quoted-secret",["has spaces secret"]),("standalone-bearer",["abcSecret.123"])]:
   with self.subTest(case=case):
    code,value,result=self.run_reader(case);self.assertEqual(code,0)
    for secret in secrets:self.assertNotIn(secret,result.stdout.decode())
    self.assertEqual(value["sessions"][0]["omissions"],[{"field":"title","reason":"credential-redacted"}])
  title=self.run_reader("credentials")[1]["sessions"][0]["metadata"]["title"]
  self.assertIn("https://example.test/watch?v=abc",title);self.assertIn("finish",title)
  title=self.run_reader("auth-url")[1]["sessions"][0]["metadata"]["title"]
  self.assertIn("example.test/view?access_token=",title);self.assertIn("&v=abc#part",title);self.assertIn("https://example.test/about",title)
  value=self.run_reader("ordinary")[1]["sessions"][0]
  self.assertEqual(value["metadata"]["title"],"Bearer bonds Password stories https://example.test/watch?v=abc&key=ordinary bob@example.test")
  self.assertEqual(value["omissions"],[])
 def test_fragment_credentials_excluded_and_ordinary_fragment_preserved(self):
  code,value,result=self.run_reader("fragment-credential");self.assertEqual(code,0)
  self.assertNotIn(b"private123",result.stdout)
  self.assertEqual(value["sessions"][0]["metadata"]["title"],"before https://example.test/callback#access%5Ftoken=[REDACTED]&chapter=2 after")
  self.assertEqual(value["sessions"][0]["omissions"],[{"field":"title","reason":"credential-redacted"}])
 def test_fixed_arguments_errors_and_deadline(self):
  self.assert_failure("selected",["private-arg"]);self.assert_failure("throw");self.assert_failure("hang")
 def test_short_explicit_auth_and_url_fragment_preservation(self):
  value=self.run_reader("short-bearer")[1]["sessions"][0]
  self.assertEqual(value["metadata"]["title"],"Authorization: Bearer [REDACTED] end")
  value=self.run_reader("url-fragment")[1]["sessions"][0]
  self.assertEqual(value["metadata"]["title"],"https://example.test/view?token=[REDACTED]#chapter")
  self.assertEqual(self.run_reader("username-url")[1]["sessions"][0]["metadata"]["title"],"https://bob@example.test/view")
  self.assertEqual(self.run_reader("ordinary-prose")[1]["sessions"][0]["metadata"]["title"],"Bearer of good news and token economics")
 def test_redaction_expansion_stays_within_field_bound(self):
  value=self.run_reader("redaction-expansion")[1]["sessions"][0]
  self.assertIsNone(value["metadata"]["title"])
  self.assertIn({"field":"title","reason":"oversized"},value["omissions"])
 def test_invalid_unicode_and_missing_result_fd(self):
  self.assert_failure("unpaired-surrogate")
  result=subprocess.run(["java","-cp",str(CLASSES),"OnnMetadataReader"],capture_output=True,timeout=6)
  self.assertEqual(result.returncode,2);self.assertEqual(result.stdout,b"");self.assertEqual(result.stderr,b"")
 def test_blocked_output_cannot_prevent_deadline_exit(self):
  read_fd,write_fd=os.pipe()
  try:
   fcntl.fcntl(write_fd,fcntl.F_SETFL,os.O_NONBLOCK)
   while True:
    try:os.write(write_fd,b"x"*4096)
    except BlockingIOError:break
   fcntl.fcntl(write_fd,fcntl.F_SETFL,0)
   cmd=["java","-Dscenario=selected","-cp",str(CLASSES),"OnnMetadataReader"]
   result=subprocess.run(["bash","-c",f"exec 3>&{write_fd} 1>/dev/null 2>/dev/null; exec "+shlex.join(cmd)],pass_fds=(write_fd,),capture_output=True,timeout=5.5)
   self.assertEqual(result.returncode,2)
  finally:os.close(read_fd);os.close(write_fd)
 def test_regular_file_output_descriptor_is_refused_without_modification(self):
  with tempfile.TemporaryFile(dir=CLASSES.parent) as stream:
   original=b"SYNTHETIC_UNRELATED_FILE";stream.write(original);stream.flush();stream.seek(0)
   cmd=["java","-Dscenario=selected","-cp",str(CLASSES),"OnnMetadataReader"]
   result=subprocess.run(["bash","-c",f"exec 3>&{stream.fileno()} 1>/dev/null 2>/dev/null; exec "+shlex.join(cmd)],pass_fds=(stream.fileno(),),capture_output=True,timeout=6)
   self.assertEqual(result.returncode,2);self.assertEqual(result.stdout,b"");self.assertEqual(result.stderr,b"")
   stream.seek(0);self.assertEqual(stream.read(),original)
if __name__=="__main__": unittest.main()
