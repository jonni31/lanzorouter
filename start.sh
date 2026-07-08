docker stop lanzorouter
docker rm lanzorouter
docker build -t lanzorouter .
docker run -d --name lanzorouter -p 1997:1997 --env-file .env -v lanzorouter-data:/app/data lanzorouter
