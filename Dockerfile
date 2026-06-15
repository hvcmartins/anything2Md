FROM python:3.12-slim

# System deps for markitdown (pdf, images, office docs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    poppler-utils \
    tesseract-ocr \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ .

ENV PYTHONUNBUFFERED=1 \
    FLASK_ENV=production \
    MAX_FILE_SIZE_MB=50

EXPOSE 7070

CMD ["gunicorn", "--bind", "0.0.0.0:7070", "--workers", "2", "--timeout", "120", "app:app"]
