# Docker/Dockerfile
FROM nginx:alpine AS base
EXPOSE 80

FROM base AS prod
# copy site into image for production builds (build context should be project root)
COPY public_html /usr/share/nginx/html

FROM base AS dev
# dev target intentionally does not COPY so compose can mount the host folder
