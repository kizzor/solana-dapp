import sqlite3, json

DB = r"C:\Users\admin\.local\share\mimocode\mimocode.db"
conn = sqlite3.connect(DB)
c = conn.cursor()

# Check message table schema
c.execute("PRAGMA table_info(message)")
print("=== MESSAGE SCHEMA ===")
for col in c.fetchall():
    print(col)

# Get a sample message to understand the data format
c.execute("SELECT id, data FROM message LIMIT 3")
print("\n=== SAMPLE MESSAGES ===")
for mid, data in c.fetchall():
    try:
        d = json.loads(data)
        print(f"  {mid}: keys={list(d.keys())}, role={d.get('role')}, content_type={type(d.get('content')).__name__}")
        if d.get('content'):
            if isinstance(d['content'], str):
                print(f"    content: {d['content'][:200]}")
            elif isinstance(d['content'], list):
                print(f"    content[0]: {str(d['content'][0])[:200]}")
    except:
        print(f"  {mid}: {data[:200]}")

# Get the latest user messages from the solana-dapp sessions
c.execute("""SELECT m.id, m.session_id, m.data FROM message m
             JOIN session s ON s.id = m.session_id
             WHERE s.directory LIKE '%solana-dapp'
             ORDER BY m.time_created DESC LIMIT 5""")
print("\n=== LATEST SOLANA-DAPP MESSAGES ===")
for mid, sid, data in c.fetchall():
    try:
        d = json.loads(data)
        role = d.get('role')
        content = d.get('content')
        if isinstance(content, str):
            preview = content[:300]
        elif isinstance(content, list):
            preview = str(content[0])[:300]
        else:
            preview = str(content)[:300]
        print(f"  [{mid}] {sid} ({role}): {preview}")
    except:
        print(f"  [{mid}] {sid}: {data[:200]}")

conn.close()
