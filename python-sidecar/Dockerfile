FROM --platform=linux/amd64 python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglu1-mesa libxrender1 libsm6 libxext6 \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /opt/requirements.txt
RUN pip install --no-cache-dir -r /opt/requirements.txt

COPY worker.py /opt/worker.py

WORKDIR /work
ENTRYPOINT ["python", "/opt/worker.py"]
