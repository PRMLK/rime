FROM node:24-alpine AS build

WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:1.29-alpine

COPY deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/frontend/dist/ /usr/share/nginx/html/
EXPOSE 8080
