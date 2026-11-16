"""Prepare the small local timeline environment; share Kokoro's existing Qwen model."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request
import uuid

ONNX_SHA256='4278337fd0ff3c68bfb6291042cad8ab363e1d9fbc43dcb499fe91c871902474'

def download_checked(url, target, checksum=None, json_file=False):
    """Never let an interrupted download become the installed model/tokenizer."""
    target = Path(target)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
            temporary = Path(handle.name)
        urllib.request.urlretrieve(url, temporary)
        data = temporary.read_bytes()
        if checksum and hashlib.sha256(data).hexdigest() != checksum:
            raise RuntimeError('The embedding model checksum did not match the tested build. Do not use this download.')
        if json_file:
            json.loads(data)
        temporary.replace(target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def atomic_json(target, value):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(json.dumps(value, indent=2).encode())
        temporary.replace(target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def setup(root,kokoro):
    root,kokoro=Path(root),Path(kokoro)/'Contents/Resources'
    if not (kokoro/'chat-model/model.safetensors.index.json').is_file():raise RuntimeError('Install Kokoro with its local Qwen reading model first.')
    root.mkdir(parents=True,exist_ok=True)
    runtime=root/'TimelineRuntime'
    if not (runtime/'bin/python').exists():subprocess.run([sys.executable,'-m','venv',str(runtime)],check=True)
    subprocess.run([str(runtime/'bin/python'),'-m','pip','install','--disable-pip-version-check','onnxruntime==1.23.2'],check=True)
    embedding=root/'TimelineModels/MiniLM';embedding.mkdir(parents=True,exist_ok=True)
    files={'model.onnx':'onnx/model_qint8_arm64.onnx','tokenizer.json':'tokenizer.json'}
    for local,remote in files.items():
        target=embedding/local
        valid = target.exists()
        if valid and local == 'model.onnx':
            valid = hashlib.sha256(target.read_bytes()).hexdigest() == ONNX_SHA256
        if valid and local == 'tokenizer.json':
            try: json.loads(target.read_bytes())
            except (ValueError, UnicodeDecodeError): valid = False
        if not valid:
            download_checked('https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/'+remote, target,
                             checksum=ONNX_SHA256 if local == 'model.onnx' else None, json_file=local.endswith('.json'))
    if hashlib.sha256((embedding/'model.onnx').read_bytes()).hexdigest()!=ONNX_SHA256:raise RuntimeError('The embedding model checksum did not match the tested build. Do not use this download.')
    if not (embedding/'LICENSE').exists():download_checked('https://www.apache.org/licenses/LICENSE-2.0.txt',embedding/'LICENSE')
    identity=root/'journal-id.txt'
    if not identity.exists():identity.write_text(str(uuid.uuid4()))
    state=root/'Timeline';state.mkdir(exist_ok=True)
    path=state/'config.json';values=json.loads(path.read_text()) if path.exists() else {}
    values.update(sourceId=identity.read_text().strip(),sourcePath=str(root/'preview-draft.html'),pythonPath=str(runtime/'bin/python'),packagesPath=str(kokoro/'chat-packages'),modelPath=str(kokoro/'chat-model'),embeddingPath=str(embedding))
    values.setdefault('dailyEnabled',True);values.setdefault('hour',12);values.setdefault('minute',0)
    atomic_json(path, values)
    print('Local models and runtime ready. No journal text was sent over the network.')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',default=str(Path.home()/'Library/Application Support/com.pcjournal.native-preview'));parser.add_argument('--kokoro',default='/Applications/Kokoro.app');args=parser.parse_args();setup(args.root,args.kokoro)
