FROM node:22-bookworm-slim
WORKDIR /app
COPY deploy/local/gateway.cjs ./gateway.cjs
USER node
EXPOSE 8080
CMD ["node", "gateway.cjs"]
