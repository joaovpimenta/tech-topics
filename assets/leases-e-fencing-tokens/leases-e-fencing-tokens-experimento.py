"""Experimento didatico: uma lease expira durante a pausa de um worker.

Python 3, somente biblioteca padrao. Nao implementa rede, consenso ou relogios
reais; reproduz deterministicamente a ordem relevante para comparar um recurso
ingenuo com outro que aplica fencing tokens.
"""

class Resource:
    def __init__(self, fenced):
        self.fenced = fenced
        self.max_token = 0
        self.value = None

    def write(self, token, value):
        if self.fenced and token < self.max_token:
            return False
        self.max_token = max(self.max_token, token)
        self.value = value
        return True


def run(fenced):
    resource = Resource(fenced)
    token_a = 41                 # A adquire e depois pausa
    token_b = 42                 # lease de A expira; B adquire
    assert resource.write(token_b, "resultado de B")
    accepted_a = resource.write(token_a, "resultado obsoleto de A")
    return resource.value, accepted_a


plain_value, plain_accepted = run(fenced=False)
fenced_value, fenced_accepted = run(fenced=True)

print("Sem fencing:", plain_value, "| A aceito:", plain_accepted)
print("Com fencing:", fenced_value, "| A aceito:", fenced_accepted)

assert plain_value == "resultado obsoleto de A"
assert fenced_value == "resultado de B"
assert fenced_accepted is False
