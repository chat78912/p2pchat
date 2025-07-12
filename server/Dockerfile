FROM python:3.11-alpine AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --target=/app/deps -r requirements.txt

FROM python:3.11-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=builder /app/deps /app/deps
COPY server.py .
ENV PYTHONPATH=/app/deps
USER nobody
EXPOSE 5082
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["python", "-u", "server.py"]