# Os testes importam os módulos do serviço como o app os roda: da pasta do serviço.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
