import sqlite3, json

DB = r"C:\Users\admin\.local\share\mimocode\mimocode.db"
conn = sqlite3.connect(DB)
c = conn.cursor()

# Get all non-system user messages from solanamark_sui sessions (SUI migration)
c.execute("""SELECT m.id, m.session_id, json_extract(p.data, '$.text') as text, m.time_created, s.title
             FROM message m
             JOIN part p ON p.message_id = m.id
             JOIN session s ON s.id = m.session_id
             WHERE s.directory LIKE '%solanamark_sui%'
               AND json_extract(m.data, '$.role') = 'user'
               AND json_extract(p.data, '$.type') = 'text'
               AND json_extract(p.data, '$.text') NOT LIKE '%<system-reminder>%'
               AND json_extract(p.data, '$.text') NOT LIKE '%system-reminder%'
               AND length(json_extract(p.data, '$.text')) > 10
             ORDER BY m.time_created DESC LIMIT 30""")
print("=== SUI MIGRATION USER MESSAGES ===")
for mid, sid, text, ts, title in c.fetchall():
    print(f"\n--- [{mid}] {sid} ({title}) ---")
    print(f"  {text[:600]}")

# Also check all sessions' titles and directories for a broader view
c.execute("""SELECT id, directory, title, time_created FROM session 
             WHERE title NOT LIKE '%checkpoint-writer%' 
             ORDER BY time_created DESC LIMIT 30""")
print("\n=== ALL NON-WRITER SESSIONS ===")
for r in c.fetchall():
    print(f"  {r[0]}: [{r[2]}] in {r[1][:60]}... (ts={r[3]})")

# Search for mentions of "testnet" in user parts
c.execute("""SELECT m.id, m.session_id, json_extract(p.data, '$.text') as text, s.title
             FROM message m
             JOIN part p ON p.message_id = m.id
             JOIN session s ON s.id = m.session_id
             WHERE json_extract(m.data, '$.role') = 'user'
               AND json_extract(p.data, '$.type') = 'text'
               AND json_extract(p.data, '$.text') NOT LIKE '%<system-reminder>%'
               AND (json_extract(p.data, '$.text') LIKE '%testnet%'
                    OR json_extract(p.data, '$.text') LIKE '%mainnet%')
             ORDER BY m.time_created DESC LIMIT 20""")
print("\n=== USER MESSAGES MENTIONING TESTNET/MAINNET ===")
for mid, sid, text, title in c.fetchall():
    print(f"  [{sid}] ({title}): {text[:400]}")

conn.close()
