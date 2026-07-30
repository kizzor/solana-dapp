import sqlite3, json

DB = r"C:\Users\admin\.local\share\mimocode\mimocode.db"
conn = sqlite3.connect(DB)
c = conn.cursor()

# Check part table schema
c.execute("PRAGMA table_info(part)")
print("=== PART SCHEMA ===")
for col in c.fetchall():
    print(col)

# Get user messages with their parts (text content)
c.execute("""SELECT m.id, m.session_id, p.data as part_data
             FROM message m
             JOIN part p ON p.message_id = m.id
             JOIN session s ON s.id = m.session_id
             WHERE s.directory LIKE '%solana-dapp'
               AND json_extract(m.data, '$.role') = 'user'
             ORDER BY m.time_created DESC LIMIT 20""")
print("\n=== USER MESSAGES WITH PARTS ===")
for mid, sid, pdata in c.fetchall():
    try:
        pd = json.loads(pdata)
        ptype = pd.get('type', 'unknown')
        if ptype == 'text':
            text = pd.get('text', '')
            print(f"  [{mid}] {sid}: {text[:400]}")
        else:
            print(f"  [{mid}] {sid}: (type={ptype})")
    except:
        print(f"  [{mid}] {sid}: {pdata[:200]}")

# Search for user rules/decisions in parts
c.execute("""SELECT m.id, m.session_id, p.data as part_data
             FROM message m
             JOIN part p ON p.message_id = m.id
             JOIN session s ON s.id = m.session_id
             WHERE s.directory LIKE '%solana-dapp'
               AND json_extract(m.data, '$.role') = 'user'
               AND json_extract(p.data, '$.type') = 'text'
               AND (json_extract(p.data, '$.text') LIKE '%never%'
                    OR json_extract(p.data, '$.text') LIKE '%always%'
                    OR json_extract(p.data, '$.text') LIKE '%remember%'
                    OR json_extract(p.data, '$.text') LIKE '%rule%'
                    OR json_extract(p.data, '$.text') LIKE '%do not%'
                    OR json_extract(p.data, '$.text') LIKE '%decision%'
                    OR json_extract(p.data, '$.text') LIKE '%error%'
                    OR json_extract(p.data, '$.text') LIKE '%broken%'
                    OR json_extract(p.data, '$.text') LIKE '%compromised%'
                    OR json_extract(p.data, '$.text') LIKE '%don''t%')
             ORDER BY m.time_created DESC LIMIT 30""")
print("\n=== USER RULES/DECISIONS/ERRORS IN PARTS ===")
for mid, sid, pdata in c.fetchall():
    try:
        pd = json.loads(pdata)
        text = pd.get('text', '')
        print(f"  [{mid}] {sid}: {text[:400]}")
    except:
        print(f"  [{mid}] {sid}: {pdata[:200]}")

conn.close()
