"""Tech Topics: experimento local de outbox; Python 3, somente biblioteca padrao.
Bancos em memoria e broker representado por lista. Falha simulada em codigo,
nao por queda real de processo. Nao implementa concorrencia, CDC ou rede.
"""
import sqlite3

producer = sqlite3.connect(":memory:")
consumer = sqlite3.connect(":memory:")
producer.executescript("""
CREATE TABLE orders (id TEXT PRIMARY KEY);
CREATE TABLE outbox (id TEXT PRIMARY KEY, order_id TEXT, sent INTEGER DEFAULT 0);
""")
consumer.executescript("""
CREATE TABLE inbox (event_id TEXT PRIMARY KEY);
CREATE TABLE effects (order_id TEXT PRIMARY KEY, applications INTEGER NOT NULL);
""")

def create_order(order_id, event_id, fail=False):
    with producer:
        producer.execute("INSERT INTO orders VALUES (?)", (order_id,))
        producer.execute("INSERT INTO outbox(id, order_id) VALUES (?, ?)",
                         (event_id, order_id))
        if fail:
            raise RuntimeError("falha antes do commit")

try:
    create_order("A", "E-A", fail=True)
except RuntimeError:
    pass
assert producer.execute("SELECT count(*) FROM orders").fetchone()[0] == 0
assert producer.execute("SELECT count(*) FROM outbox").fetchone()[0] == 0
print("Rollback: 0 pedidos, 0 eventos")

create_order("A", "E-A")
broker = []

def relay(fail_after_publish=False):
    for event_id, order_id in producer.execute(
            "SELECT id, order_id FROM outbox WHERE sent = 0").fetchall():
        broker.append((event_id, order_id))  # aceite simulado pelo broker
        if fail_after_publish:
            return  # simula queda antes de marcar; evento continua pendente
        with producer:
            producer.execute("UPDATE outbox SET sent = 1 WHERE id = ?", (event_id,))

relay(fail_after_publish=True)
relay()
assert broker == [("E-A", "A"), ("E-A", "A")]
print("Relay: 2 entregas do mesmo evento")

for event_id, order_id in broker:
    with consumer:
        inserted = consumer.execute(
            "INSERT OR IGNORE INTO inbox VALUES (?)", (event_id,)).rowcount
        if inserted:
            consumer.execute("INSERT INTO effects VALUES (?, 1)", (order_id,))

assert consumer.execute("SELECT applications FROM effects").fetchone()[0] == 1
assert consumer.execute("SELECT count(*) FROM inbox").fetchone()[0] == 1
print("Inbox: 1 efeito aplicado")
