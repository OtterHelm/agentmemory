FROM agentmemory-local:0.9.29
LABEL org.agentmemory.local-patch="incremental-ko4" org.agentmemory.upstream="e04ba88819c365c9acf9d6661ea802143e728bd6"
COPY dist/index.mjs dist/index.mjs.map /opt/agentmemory/node_modules/@agentmemory/agentmemory/dist/
COPY dist/viewer/ /opt/agentmemory/node_modules/@agentmemory/agentmemory/dist/viewer/
RUN node -e "const fs=require('fs'); const p='/opt/agentmemory/node_modules/@agentmemory/agentmemory/dist/cli.mjs'; const s=fs.readFileSync(p,'utf8'); if(!s.includes('./src-G7yt8gGm.mjs')) throw Error('Unexpected base launcher'); fs.writeFileSync(p,s.replaceAll('./src-G7yt8gGm.mjs','./index.mjs'));"
