# Use the official lightweight Nginx image
FROM nginx:alpine

# Copy your static website files to the Nginx default serving directory
COPY . /usr/share/nginx/html

# The container exposes port 80 by default, and the CMD is already set in the base image
EXPOSE 80
