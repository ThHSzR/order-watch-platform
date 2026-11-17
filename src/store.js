import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';

export async function openStore(filename, { readonly = false } = {}) {
  const SQL = await initSqlJs();
  const absolute = path.resolve(filename);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  let db = fs.existsSync(absolute) ? new SQL.Database(fs.readFileSync(absolute)) : new SQL.Database();
  if (!readonly) db.run(`CREATE TABLE IF NOT EXISTS current (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT OR IGNORE INTO current(id,state,updated_at) VALUES(1,'UNKNOWN',datetime('now'));
    CREATE TABLE IF NOT EXISTS runtime (id INTEGER PRIMARY KEY CHECK(id=1), monitor_state TEXT NOT NULL DEFAULT 'IDLE', last_attempt TEXT, last_success TEXT, failures INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0, pause_reason TEXT, last_result TEXT);
    INSERT OR IGNORE INTO runtime(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, old_state TEXT, new_state TEXT, at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual');
    CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, state TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, sent_at TEXT, status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS notification_sequence (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
    INSERT OR IGNORE INTO notification_sequence(id,value) VALUES(1,0);
    CREATE TABLE IF NOT EXISTS delivery_estimate (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT OR IGNORE INTO delivery_estimate(id,value) VALUES(1,NULL);
    CREATE TABLE IF NOT EXISTS shipment_tracking_meta (id INTEGER PRIMARY KEY CHECK(id=1), initialized INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO shipment_tracking_meta(id,initialized) VALUES(1,0);
    CREATE TABLE IF NOT EXISTS shipment_events (event_key TEXT PRIMARY KEY, event_date TEXT NOT NULL, event_time TEXT NOT NULL, message TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', first_seen_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS monitor_alert_state (id INTEGER PRIMARY KEY CHECK(id=1), auth_alert_active INTEGER NOT NULL DEFAULT 0, failure_alert_active INTEGER NOT NULL DEFAULT 0, unrecognized_status TEXT);
    INSERT OR IGNORE INTO monitor_alert_state(id,auth_alert_active) VALUES(1,0);`);
  const historyColumns = new Set(db.exec('PRAGMA table_info(history)')[0]?.values?.map(row => row[1]) ?? []);
  if (!readonly && !historyColumns.has('source')) { db.run("ALTER TABLE history ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'"); historyColumns.add('source'); }
  const notificationColumns = new Set(db.exec('PRAGMA table_info(notifications)')[0]?.values?.map(row => row[1]) ?? []);
  if (!readonly && !notificationColumns.has('status')) { db.run("ALTER TABLE notifications ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"); notificationColumns.add('status'); }
  const runtimeColumns = new Set(db.exec('PRAGMA table_info(runtime)')[0]?.values?.map(row => row[1]) ?? []);
  if (!readonly && !runtimeColumns.has('last_result')) { db.run('ALTER TABLE runtime ADD COLUMN last_result TEXT'); runtimeColumns.add('last_result'); }
  const monitorAlertColumns = new Set(db.exec('PRAGMA table_info(monitor_alert_state)')[0]?.values?.map(row => row[1]) ?? []);
  if (!readonly && monitorAlertColumns.size && !monitorAlertColumns.has('consecutive_auth_checks')) db.run('ALTER TABLE monitor_alert_state ADD COLUMN consecutive_auth_checks INTEGER NOT NULL DEFAULT 0');
  if (!readonly && monitorAlertColumns.size && !monitorAlertColumns.has('failure_alert_active')) db.run('ALTER TABLE monitor_alert_state ADD COLUMN failure_alert_active INTEGER NOT NULL DEFAULT 0');
  if (!readonly && monitorAlertColumns.size && !monitorAlertColumns.has('unrecognized_status')) db.run('ALTER TABLE monitor_alert_state ADD COLUMN unrecognized_status TEXT');
  const hasRuntime = runtimeColumns.size > 0;
  const hasNotificationStatus = notificationColumns.has('status');
  if (!readonly && notificationColumns.has('status')) db.run("UPDATE notifications SET status='uncertain' WHERE status='sending'");

  function persist() {
    if (readonly) return;
    const temp = `${absolute}.${process.pid}.tmp`;
    fs.writeFileSync(temp, Buffer.from(db.export()), { mode: 0o600 });
    try { fs.renameSync(temp, absolute); }
    catch (error) { try { fs.rmSync(temp, { force: true }); } catch {} throw error; }
  }
  function transact(fn) {
    if (readonly) throw new Error('Store aberto somente para leitura');
    const before = db.export();
    db.run('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.run('COMMIT');
      persist();
      return result;
    } catch (error) {
      try { db.run('ROLLBACK'); } catch {}
      db.close();
      db = new SQL.Database(before);
      throw error;
    }
  }
  if (!readonly) persist();
  function current() { return db.exec('SELECT state,updated_at FROM current WHERE id=1')[0]?.values[0]; }
  function runtime() { return hasRuntime ? query('SELECT monitor_state,last_attempt,last_success,failures,paused,pause_reason,last_result FROM runtime WHERE id=1')[0] : { monitor_state:'IDLE',last_attempt:null,last_success:null,failures:0,paused:0,pause_reason:null,last_result:null }; }
  function recordCheck({ monitorState, attemptAt, successAt, failures, paused, pauseReason, lastResult }) {
    transact(() => db.run('UPDATE runtime SET monitor_state=COALESCE(?,monitor_state),last_attempt=COALESCE(?,last_attempt),last_success=COALESCE(?,last_success),failures=COALESCE(?,failures),paused=COALESCE(?,paused),pause_reason=CASE WHEN ?=0 THEN NULL ELSE COALESCE(?,pause_reason) END,last_result=COALESCE(?,last_result) WHERE id=1',
      [monitorState ?? null,attemptAt ?? null,successAt ?? null,failures ?? null,paused === undefined ? null : Number(paused),paused === undefined ? null : Number(paused),pauseReason ?? null,lastResult ?? null]));
  }
  function setPaused(paused, reason = null) {
    transact(() => db.run('UPDATE runtime SET paused=?,pause_reason=? WHERE id=1',[Number(paused),paused ? reason : null]));
  }
  function insertNotification(state, payload) {
    db.run('UPDATE notification_sequence SET value=value+1 WHERE id=1');
    const id=String(db.exec('SELECT value FROM notification_sequence WHERE id=1')[0].values[0][0]);
    db.run("INSERT OR IGNORE INTO notifications(id,state,payload,created_at,status) VALUES(?,?,?,datetime('now'),'pending')",[id,state,JSON.stringify(payload)]);
    return id;
  }
  function recordTransition(next, source, notification) {
    return transact(() => {
      const previous = current()?.[0] ?? 'UNKNOWN';
      db.run("UPDATE current SET state=?,updated_at=datetime('now') WHERE id=1", [next]);
      db.run("INSERT INTO history(old_state,new_state,at,source) VALUES(?,?,datetime('now'),?)", [previous,next,source]);
      let notificationId = null;
      if (notification) notificationId=insertNotification(next,notification.payload);
      return { previous, notificationId };
    });
  }
  function deliveryEstimate() { return query('SELECT value FROM delivery_estimate WHERE id=1')[0]?.value ?? null; }
  function recordDeliveryEstimate(value, notificationFactory = null) {
    return transact(() => {
      const previous=deliveryEstimate();
      if(previous===value)return {previous,current:value,changed:false,notificationId:null};
      db.run("UPDATE delivery_estimate SET value=?,updated_at=datetime('now') WHERE id=1",[value]);
      const payload=previous&&notificationFactory?notificationFactory(previous,value):null;
      const notificationId=payload?insertNotification('DELIVERY_DATE_CHANGED',payload):null;
      return {previous,current:value,changed:true,notificationId};
    });
  }
  function recordShipmentEvents(events, notificationFactory = null) {
    return transact(() => {
      const initialized=Number(query('SELECT initialized FROM shipment_tracking_meta WHERE id=1')[0]?.initialized??0)===1;
      const notificationIds=[];
      let added=0;
      for(const event of events){
        const existing=query('SELECT event_time FROM shipment_events WHERE event_key=?',[event.eventKey])[0];
        if(existing){
          if(!existing.event_time&&event.timeText)db.run('UPDATE shipment_events SET event_time=? WHERE event_key=?',[event.timeText,event.eventKey]);
          continue;
        }
        const prior=query("SELECT event_key,event_time FROM shipment_events WHERE event_date=? AND message=? AND location=? AND (event_time=? OR event_time='' OR ?='') LIMIT 1",
          [event.dateText,event.message,event.location||'',event.timeText||'',event.timeText||'']);
        if(prior.length){
          if(!prior[0].event_time&&event.timeText)db.run('UPDATE shipment_events SET event_time=? WHERE event_key=?',[event.timeText,prior[0].event_key]);
          continue;
        }
        db.run("INSERT INTO shipment_events(event_key,event_date,event_time,message,location,first_seen_at) VALUES(?,?,?,?,?,datetime('now'))",
          [event.eventKey,event.dateText,event.timeText,event.message,event.location||'']);
        added++;
        if(initialized&&notificationFactory){
          const notification=notificationFactory(event);
          if(notification)notificationIds.push(insertNotification('SHIPMENT_EVENT',notification));
        }
      }
      if(!initialized)db.run('UPDATE shipment_tracking_meta SET initialized=1 WHERE id=1');
      return {baseline:!initialized,added,notificationIds};
    });
  }
  function queueAuthAlert(payload) {
    return transact(() => {
      const active=Number(query('SELECT auth_alert_active FROM monitor_alert_state WHERE id=1')[0]?.auth_alert_active??0)===1;
      if(active)return null;
      db.run('UPDATE monitor_alert_state SET auth_alert_active=1 WHERE id=1');
      return insertNotification('MONITOR_AUTH_REQUIRED',payload);
    });
  }
  function recordAuthCheck() {
    return transact(() => {
      db.run('UPDATE monitor_alert_state SET consecutive_auth_checks=consecutive_auth_checks+1 WHERE id=1');
      return Number(query('SELECT consecutive_auth_checks FROM monitor_alert_state WHERE id=1')[0]?.consecutive_auth_checks??0);
    });
  }
  function clearAuthAlert() {
    transact(() => {
      db.run('UPDATE monitor_alert_state SET auth_alert_active=0,consecutive_auth_checks=0 WHERE id=1');
      db.run("UPDATE notifications SET status='cancelled' WHERE state='MONITOR_AUTH_REQUIRED' AND status='pending'");
    });
  }
  function queueFailureAlert(payload) {
    return transact(() => {
      const active=Number(query('SELECT failure_alert_active FROM monitor_alert_state WHERE id=1')[0]?.failure_alert_active??0)===1;
      if(active)return null;
      db.run('UPDATE monitor_alert_state SET failure_alert_active=1 WHERE id=1');
      return insertNotification('MONITOR_CHECK_FAILED',payload);
    });
  }
  function clearFailureAlert(payload) {
    return transact(() => {
      const active=Number(query('SELECT failure_alert_active FROM monitor_alert_state WHERE id=1')[0]?.failure_alert_active??0)===1;
      if(!active)return null;
      db.run('UPDATE monitor_alert_state SET failure_alert_active=0 WHERE id=1');
      db.run("UPDATE notifications SET status='cancelled' WHERE state='MONITOR_CHECK_FAILED' AND status='pending'");
      return insertNotification('MONITOR_RECOVERED',payload);
    });
  }
  function queueUnrecognizedStatus(statusText,payload) {
    return transact(() => {
      const previous=query('SELECT unrecognized_status FROM monitor_alert_state WHERE id=1')[0]?.unrecognized_status;
      if(previous===statusText)return null;
      db.run('UPDATE monitor_alert_state SET unrecognized_status=? WHERE id=1',[statusText]);
      return insertNotification('ORDER_STATUS_UNRECOGNIZED',payload);
    });
  }
  function clearUnrecognizedStatus() {
    transact(() => db.run('UPDATE monitor_alert_state SET unrecognized_status=NULL WHERE id=1'));
  }
  function query(sql, params = []) {
    const stmt = db.prepare(sql);
    try { stmt.bind(params); const rows=[]; while (stmt.step()) rows.push(stmt.getAsObject()); return rows; }
    finally { stmt.free(); }
  }
  function pending() { return hasNotificationStatus ? query("SELECT * FROM notifications WHERE status='pending' ORDER BY CAST(id AS INTEGER) LIMIT 1")[0] ?? null : null; }
  function mark(id, status, sentAt = null) {
    transact(() => db.run('UPDATE notifications SET status=?,sent_at=COALESCE(?,sent_at) WHERE id=?', [status,sentAt,id]));
  }
  function history() { return historyColumns.has('source') ? query('SELECT old_state,new_state,at,source FROM history ORDER BY id DESC LIMIT 50') : query("SELECT old_state,new_state,at,'legacy' AS source FROM history ORDER BY id DESC LIMIT 50"); }
  function notifications() { return hasNotificationStatus ? query('SELECT id,state,status,created_at,sent_at FROM notifications ORDER BY created_at DESC LIMIT 50') : query("SELECT id,state,CASE WHEN sent_at IS NULL THEN 'uncertain' ELSE 'confirmed' END AS status,created_at,sent_at FROM notifications ORDER BY created_at DESC LIMIT 50"); }
  function close() { if (!readonly) persist(); db.close(); }
  return { current, runtime, recordCheck, setPaused, recordTransition, deliveryEstimate, recordDeliveryEstimate, recordShipmentEvents, queueAuthAlert, recordAuthCheck, clearAuthAlert, queueFailureAlert, clearFailureAlert, queueUnrecognizedStatus, clearUnrecognizedStatus, pending, mark, history, notifications, close };
}
