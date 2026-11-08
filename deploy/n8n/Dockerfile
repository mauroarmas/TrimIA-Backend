FROM n8nio/n8n:2.30.7
COPY --chmod=755 deploy/n8n/start.sh /opt/trimia-start.sh
ENTRYPOINT ["tini", "--", "/opt/trimia-start.sh"]
