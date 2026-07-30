import sqlite3, json

DB = r"C:\Users\admin\.local\share\mimocode\mimocode.db"
conn = sqlite3.connect(DB)
c = conn.cursor()

# Get ALL user text parts that are NOT system-reminders, from solana-dapp sessions
c.execute("""SELECT m.id, m.session_id, json_extract(p.data, '$.text') as text, m.time_created
             FROM message m
             JOIN part p ON p.message_id = m.id
             JOIN session s ON s.id = m.session_id
             WHERE s.directory LIKE '%solana-dapp'
               AND json_extract(m.data, '$.role') = 'user'
               AND json_extract(p.data, '$.type') = 'text'
               AND json_extract(p.data, '$.text') NOT LIKE '%<system-reminder>%'
               AND json_extract(p.data, '$.text') NOT LIKE '%system-reminder%'
               AND length(json_extract(p.data, '$.text')) > 10
             ORDER BY m.time_created DESC""")
print("=== ALL NON-SYSTEM USER MESSAGES ===")
for mid, sid, text, ts in c.fetchall():
    print(f"\n--- [{mid}] {sid} (ts={ts}) ---")
    print(f"  {text[:600]}")

# Also check assistant tool calls/results for key technical facts
print("\n\n=== ASSISTANT TOOL RESULTS (errors/key findings) ===")
c.execute("""SELECT m.id, m.session_id, json_extract(p.data, '$.tool') as tool,
             json_extract(p.data, '$.state.output') as output, m.time_created
             FROM message m
             JOIN part p ON p.message_id = m.id
             JOIN session s ON s.id = m.session_id
             WHERE s.directory LIKE '%solana-dapp'
               AND json_extract(m.data, '$.role') = 'assistant'
               AND json_extract(p.data, '$.type') = 'tool'
               AND json_extract(p.data, '$.tool') IS NOT NULL
               AND json_extract(p.data, '$.state.output') IS NOT NULL
             ORDER BY m.time_created DESC LIMIT 30""")
for mid, sid, tool, output, ts in c.fetchall():
    if output and len(str(output)) > 5:
        preview = str(output)[:300].replace('\n', ' ')
        print(f"  [{tool}] {sid}: {preview}")

conn.close()
