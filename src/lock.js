import fs from 'node:fs';
import path from 'node:path';

export function acquireLock(file) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const fd=fs.openSync(file,'wx',0o600);
      fs.writeFileSync(fd,`${process.pid}\n`);
      return ()=>{ try{fs.closeSync(fd);}catch{} try{fs.unlinkSync(file);}catch{} };
    } catch(error) {
      if(error.code!=='EEXIST') throw error;
      let pid=0;
      try{pid=Number(fs.readFileSync(file,'utf8').trim());}catch{}
      let alive=false;
      if(pid>0) try{process.kill(pid,0);alive=true;}catch(e){alive=e.code==='EPERM';}
      if(alive) throw Error('Outra instância do watcher já está ativa');
      try{fs.unlinkSync(file);}catch{}
    }
  }
  throw Error('Não foi possível reservar o lock do watcher');
}
