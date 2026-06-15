import io
import os
import uuid
import zipfile
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file, session
from markitdown import MarkItDown

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(24))

MAX_FILES = 20
MAX_FILE_SIZE_MB = int(os.environ.get("MAX_FILE_SIZE_MB", 50))
MAX_CONTENT_LENGTH = MAX_FILE_SIZE_MB * 1024 * 1024

app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH * MAX_FILES

# In-memory store: session_id -> {original_name: markdown_text}
_store: dict[str, dict[str, str]] = {}

md = MarkItDown()


def get_session_store() -> dict[str, str]:
    sid = session.get("sid")
    if not sid or sid not in _store:
        sid = str(uuid.uuid4())
        session["sid"] = sid
        _store[sid] = {}
    return _store[sid]


@app.route("/")
def index():
    return render_template("index.html", max_files=MAX_FILES, max_mb=MAX_FILE_SIZE_MB)


@app.route("/convert", methods=["POST"])
def convert():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    store = get_session_store()
    if len(store) >= MAX_FILES:
        return jsonify({"error": f"Maximum of {MAX_FILES} files reached"}), 400

    original_name = Path(file.filename).name
    file_bytes = file.read()

    suffix = Path(original_name).suffix or ".bin"
    tmp_path = Path("/tmp") / f"{uuid.uuid4()}{suffix}"
    try:
        tmp_path.write_bytes(file_bytes)
        result = md.convert(str(tmp_path))
        markdown = result.text_content
    except Exception as exc:
        return jsonify({"error": f"Conversion failed: {exc}"}), 422
    finally:
        tmp_path.unlink(missing_ok=True)

    md_name = Path(original_name).stem + ".md"
    # avoid collisions
    base, counter = md_name, 1
    while md_name in store:
        md_name = f"{Path(base).stem}_{counter}.md"
        counter += 1

    store[md_name] = markdown
    return jsonify({"name": md_name, "chars": len(markdown)})


@app.route("/download/<path:filename>")
def download_one(filename: str):
    store = get_session_store()
    if filename not in store:
        return jsonify({"error": "File not found"}), 404
    buf = io.BytesIO(store[filename].encode())
    return send_file(buf, as_attachment=True, download_name=filename, mimetype="text/markdown")


@app.route("/download-zip", methods=["POST"])
def download_zip():
    store = get_session_store()
    names = request.json.get("files", list(store.keys())) if request.is_json else list(store.keys())
    if not names:
        return jsonify({"error": "Nothing to zip"}), 400

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in names:
            if name in store:
                zf.writestr(name, store[name])
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="converted.zip", mimetype="application/zip")


@app.route("/clear", methods=["POST"])
def clear():
    sid = session.get("sid")
    if sid and sid in _store:
        _store.pop(sid)
    session.pop("sid", None)
    return jsonify({"ok": True})


@app.errorhandler(413)
def too_large(_):
    return jsonify({"error": f"File too large (max {MAX_FILE_SIZE_MB} MB)"}), 413
