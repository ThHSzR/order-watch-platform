const timezone = 'America/Sao_Paulo';
const months = {
  janeiro:1, jan:1, fevereiro:2, fev:2, marco:3, mar:3, abril:4, abr:4,
  maio:5, mai:5, junho:6, jun:6, julho:7, jul:7, agosto:8, ago:8,
  setembro:9, set:9, outubro:10, out:10, novembro:11, nov:11, dezembro:12, dez:12,
};
const weekdays = { domingo:0, segunda:1, terca:2, quarta:3, quinta:4, sexta:5, sabado:6 };
const normalized = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const pad = value => String(value).padStart(2,'0');

function todayParts(now) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(part=>[part.type,part.value]));
  return { year:Number(parts.year), month:Number(parts.month), day:Number(parts.day) };
}

function iso(year,month,day) {
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function inferredYear(month,day,today,explicitYear) {
  if(explicitYear)return explicitYear<100?2000+explicitYear:explicitYear;
  const current=Date.UTC(today.year,today.month-1,today.day);
  let year=today.year;
  const candidate=Date.UTC(year,month-1,day);
  if(candidate-current < -180*86400000)year++;
  return year;
}

function monthNumber(name) { return months[name.replace(/\.$/,'')] ?? null; }

export function parseDeliveryEstimate(value, now = new Date()) {
  if(typeof value!=='string'||!value.trim())return null;
  const source=normalized(value).replace(/\s+/g,' ').trim();
  const today=todayParts(now);
  const todayIso=iso(today.year,today.month,today.day);
  const dateAfter=days=>{
    const date=new Date(Date.UTC(today.year,today.month-1,today.day+days));
    return date.toISOString().slice(0,10);
  };

  if(/\bdepois de amanha\b/.test(source))return dateAfter(2);
  if(/\bamanha\b/.test(source))return dateAfter(1);
  if(/\bhoje\b/.test(source))return todayIso;

  const monthPattern=Object.keys(months).sort((a,b)=>b.length-a.length).join('|');
  const range=new RegExp(`\\b(\\d{1,2})\\s*(?:a|ate|e|[-–])\\s*(\\d{1,2})\\s+(?:de\\s+)?(${monthPattern})\\b(?:\\s+(?:de\\s+)?(\\d{4}))?`).exec(source);
  if(range){
    const month=monthNumber(range[3]);
    const year=inferredYear(month,Number(range[1]),today,range[4]?Number(range[4]):null);
    const start=iso(year,month,Number(range[1]));
    const end=iso(year,month,Number(range[2]));
    if(start&&end)return `${start}/${end}`;
  }

  const numeric=/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/.exec(source);
  if(numeric){
    const day=Number(numeric[1]),month=Number(numeric[2]);
    const year=inferredYear(month,day,today,numeric[3]?Number(numeric[3]):null);
    const result=iso(year,month,day);
    if(result)return result;
  }

  const monthDate=new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${monthPattern})\\b(?:\\s+(?:de\\s+)?(\\d{4}))?`).exec(source);
  if(monthDate){
    const day=Number(monthDate[1]),month=monthNumber(monthDate[2]);
    const year=inferredYear(month,day,today,monthDate[3]?Number(monthDate[3]):null);
    const result=iso(year,month,day);
    if(result)return result;
  }

  const weekdayPattern=/\b(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\b/g;
  const matches=[...source.matchAll(weekdayPattern)].map(match=>match[1].split('-')[0]);
  if(matches.length){
    const dates=matches.slice(0,2).map(name=>{
      const current=new Date(Date.UTC(today.year,today.month-1,today.day));
      const delta=(weekdays[name]-current.getUTCDay()+7)%7;
      return dateAfter(delta);
    });
    return dates.length===2?`${dates[0]}/${dates[1]}`:dates[0];
  }
  return null;
}
