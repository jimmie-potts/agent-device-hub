# Disposable static-analysis control. Never execute or merge.
import os

from flask import Flask, request

app = Flask(__name__)


@app.route('/codeql-control')
def command_control():
    os.system(request.args['command'])
    return 'source-only control'
