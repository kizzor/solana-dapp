import sqlite3, json

DB = r"C:\Users\admin\.local\share\mimocode\mimocode.db"
conn = sqlite3.connect(DB)
c = conn.cursor()

# Get sessions from E:\dapp (earlier RANSOME DAPP work)
c.execute("""SELECT m.id, m.session_id, json_extract(p.data, '$.text') as text, m.time_created, s.title
             FROM message m
             JOIN part p ON p.message_id = m.id
             JOIN session s ON s.id = m.session_id
             WHERE s.directory LIKE '%dapp%'
               AND json_extract(m.data, '$.role') = 'user'
               AND json_extract(p.data, '$.type') = 'text'
               AND json_extract(p.data, '$.text') NOT LIKE '%<system-reminder>%'
               AND json_extract(p.data, '$.text') NOT LIKE '%system-reminder%'
               AND length(json_extract(p.data, '$.text')) > 10
             ORDER BY m.time_created DESC LIMIT 20""")
print("=== E:\\dapp USER MESSAGES ===")
for mid, sid, text, ts, title in c.fetchall():
    print(f"\n--- [{sid}] ({title}) ---")
    print(f"  {text[:500]}")

# Look for earlier solana-dapp sessions or RANSOME-related content
c.execute("""SELECT id, directory, title, time_created FROM session 
             WHERE title LIKE '%ransom%' OR title LIKE '%RANSOM%'
             ORDER BY time_created ASC""")
print("\n=== RANSOME-TITLED SESSIONS ===")
for r in c.fetchall():
    print(f"  {r[0]}: [{r[2]}] in {r[1][:80]}... (ts={r[3]})")

# Check older checkpoints
c.execute("""SELECT id, directory, title, time_created FROM session 
             WHERE directory LIKE '%solana-dapp%'
             ORDER BY time_created ASC""")
print("\n=== ALL SOLANA-DAPP SESSIONS (oldest first) ===")
for r in c.fetchall():
    print(f"  {r[0]}: [{r[2][:80]}] (ts={r[3]})")

# Get assistant text output from key sessions
c.execute("""SELECT m.id, m.session_id, json_extract(p.data, '$.text') as text, s.title
             FROM message m
             JOIN part p ON p.message_id = m.id
             JOIN session s ON s.id = m.session_id
             WHERE s.directory LIKE '%solana-dapp%'
               AND json_extract(m.data, '$.role') = 'assistant'
               AND json_extract(p.data, '$.type') = 'text'
               AND json_extract(p.data, '$.text') IS NOT NULL
               AND length(json_extract(p.data, '$.text')) > 50
             ORDER BY m.time_created ASC LIMIT 10""")
print("\n=== ASSISTANT TEXT OUTPUT (earliest) ===")
for mid, sid, text, title in c.fetchall():
    print(f"\n--- [{sid}] ({title}) ---")
    print(f"  {text[:500]}")

conn.close()
