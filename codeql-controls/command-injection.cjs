// Disposable static-analysis control. Never execute or merge.
const childProcess = require('child_process');
const http = require('http');
const url = require('url');

http.createServer((request) => {
  const suppliedPath = url.parse(request.url, true).query.path;
  childProcess.execSync(`wc -l ${suppliedPath}`);
});
