// Modified by OtterHelm for this custom distribution; see deploy/local/README.md.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
if (process.cwd() !== '/verify') throw new Error('Only normalize the isolated Linux test copy');
function visit(dir) {
  for (const entry of readdirSync(dir,{withFileTypes:true})) {
    if (['node_modules','.git','dist'].includes(entry.name)) continue;
    const path=join(dir,entry.name);
    if(entry.isDirectory()) visit(path);
    else if (/\.(?:ts|yaml|yml|md|json|mjs)$/.test(entry.name)) {
      const text=readFileSync(path,'utf8');
      if(text.includes('\r\n')) writeFileSync(path,text.replaceAll('\r\n','\n'));
    }
  }
}
visit(resolve('.'));
