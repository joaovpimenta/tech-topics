"""Experimento deterministico de CQRS, somente com a biblioteca padrao.

O exemplo separa um estado autoritativo de escrita de uma projecao de leitura,
mostra uma leitura obsoleta, tolera entrega duplicada e reconstrui a projecao a
partir de um snapshot da fonte. Nao implementa broker, rede ou Event Sourcing.
"""

from copy import deepcopy


write_store = {
    "B-42": {"message": "Parabens, Lia", "version": 1},
}
outbox = []
read_model = deepcopy(write_store)


def change_message(order_id, message, expected_version):
    current = write_store[order_id]
    if current["version"] != expected_version:
        raise ValueError("versao inesperada")

    new_version = current["version"] + 1
    write_store[order_id] = {"message": message, "version": new_version}
    outbox.append(
        {
            "event_id": f"{order_id}:{new_version}",
            "order_id": order_id,
            "message": message,
            "version": new_version,
        }
    )
    return new_version


def project(event):
    """Aplica eventos de estado completo e ignora versoes repetidas/antigas."""
    current = read_model.get(event["order_id"], {"version": 0})
    if event["version"] <= current["version"]:
        return "ignored"
    read_model[event["order_id"]] = {
        "message": event["message"],
        "version": event["version"],
    }
    return "applied"


accepted_version = change_message("B-42", "Viva, Lia", expected_version=1)
print("command accepted at version", accepted_version)
print("query before projection", read_model["B-42"])

event = outbox[0]
print("first delivery", project(event))
print("duplicate delivery", project(event))
print("query after projection", read_model["B-42"])

# A reconstrucao vem do estado autoritativo, nao do outbox temporario.
rebuilt_model = deepcopy(write_store)
assert rebuilt_model == read_model
print("rebuilt projection matches", rebuilt_model == read_model)

# Modelo fluido didatico de backlog: 120 eventos/s, 40 s sem projetor.
arrival_rate = 120
recovery_rate = 200
outage_seconds = 40
backlog = arrival_rate * outage_seconds
drain_seconds = backlog / (recovery_rate - arrival_rate)
print("backlog after outage", backlog)
print("drain time in seconds", int(drain_seconds))

