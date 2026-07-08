docker stop zevairouter
docker rm zevairouter
docker build -t zevairouter .
docker run -d --name zevairouter -p 1997:1997 --env-file .env -v zevairouter-data:/app/data zevairouter
