FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY gateway/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY gateway/app.py /app/app.py
COPY gateway/xtream_monitor.py /app/xtream_monitor.py
COPY gateway/xtream_import.py /app/xtream_import.py
COPY gateway/xtream_store.py /app/xtream_store.py

EXPOSE 10000

CMD ["sh","-c","uvicorn app:app --host 0.0.0.0 --port ${PORT:-10000}"]
