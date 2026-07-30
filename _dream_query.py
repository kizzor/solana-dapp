import sqlite3, json, sys

DB = r"C:\Users\admin\.local\share\mimocode\mimocode.db"
conn = sqlite3.connect(DB)
c = conn.cursor()

# 1. List solana-dapp sessions
c.execute("SELECT id, directory, title, time_created FROM session WHERE directory LIKE '%solana-dapp' ORDER BY time_created DESC LIMIT 10")
print("=== SOLANA-DAPP SESSIONS ===")
for r in c.fetchall():
    print(r)

# 2. Get the most recent user messages from the last 3 sessions
c.execute("SELECT id, directory, title, time_created FROM session WHERE directory LIKE '%solana-dapp' ORDER BY time_created DESC LIMIT 3")
sessions = c.fetchall()
for sid, _, title, ts in sessions:
    print(f"\n--- Session {sid} ({title}) ---")
    c.execute("""SELECT m.id, json_extract(m.data, '$.role') as role, 
                 substr(json_extract(m.data, '$.content'), 1, 500) as content_preview
                 FROM message m 
                 WHERE m.session_id = ? AND json_extract(m.data, '$.role') = 'user'
                 ORDER BY m.time_created DESC LIMIT 3""", (sid,))
    for mid, role, preview in c.fetchall():
        print(f"  USER [{mid}]: {preview[:300] if preview else '(empty)'}")

# 3. Search for user statements about rules, decisions, errors, always/never
c.execute("""SELECT m.session_id, substr(json_extract(m.data, '$.content'), 1, 500) as content
             FROM message m
             JOIN session s ON s.id = m.session_id
             WHERE s.directory LIKE '%solana-dapp'
               AND json_extract(m.data, '$.role') = 'user'
               AND (json_extract(m.data, '$.content') LIKE '%never%'
                    OR json_extract(m.data, '$.content') LIKE '%always%'
                    OR json_extract(m.data, '$.content') LIKE '%remember%'
                    OR json_extract(m.data, '$.content') LIKE '%rule%'
                    OR json_extract(m.data, '$.content') LIKE '%do not%'
                    OR json_extract(m.data, '$.content') LIKE '%decision%'
                    OR json_extract(m.data, '$.content') LIKE '%don''t%'
                    OR json_extract(m.data, '$.content') LIKE '%don''t%'
                    OR json_extract(m.data, '$.content') LIKE '%error%'
                    OR json_extract(m.data, '$.content') LIKE '%broken%'
                    OR json_extract(m.data, '$.content') LIKE '%compromised%')
             ORDER BY m.time_created DESC LIMIT 20""", )
print("\n=== USER RULES/DECISIONS/ERRORS ===")
for sid, preview in c.fetchall():
    print(f"  [{sid}]: {preview[:400] if preview else '(empty)'}")

conn.close()
