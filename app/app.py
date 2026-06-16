import io
import os
import uuid
import zipfile
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file
from markitdown import MarkItDown

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(24))

MAX_FILES = 20
MAX_FILE_SIZE_MB = int(os.environ.get("MAX_FILE_SIZE_MB", 50))

app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE_MB * 1024 * 1024 * MAX_FILES

md = MarkItDown()

# Track output names per process to avoid collisions across concurrent requests
_used_names: set[str] = set()


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

    original_name = Path(file.filename).name
    suffix = Path(original_name).suffix or ".bin"
    tmp_path = Path("/tmp") / f"{uuid.uuid4()}{suffix}"
    try:
        tmp_path.write_bytes(file.read())
        result = md.convert(str(tmp_path))
        markdown = result.text_content
    except Exception as exc:
        return jsonify({"error": f"Conversion failed: {exc}"}), 422
    finally:
        tmp_path.unlink(missing_ok=True)

    # Unique output name
    md_name = Path(original_name).stem + ".md"
    base, counter = md_name, 1
    while md_name in _used_names:
        md_name = f"{Path(base).stem}_{counter}.md"
        counter += 1
    _used_names.add(md_name)

    # Return content directly — client stores it, no session needed
    return jsonify({"name": md_name, "chars": len(markdown), "content": markdown})


@app.route("/download-zip", methods=["POST"])
def download_zip():
    payload = request.get_json(silent=True) or {}
    files = payload.get("files", [])  # [{name, content}, ...]
    if not files:
        return jsonify({"error": "Nothing to zip"}), 400

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            if f.get("name") and f.get("content") is not None:
                zf.writestr(f["name"], f["content"])
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="converted.zip", mimetype="application/zip")


@app.errorhandler(413)
def too_large(_):
    return jsonify({"error": f"File too large (max {MAX_FILE_SIZE_MB} MB)"}), 413
