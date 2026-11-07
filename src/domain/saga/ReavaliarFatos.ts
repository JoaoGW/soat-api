import { EstadoSaga, FatoSaga, proximoEstado } from './EstadoSaga';

export interface FatoPendente {
  messageId: string;
  fato: FatoSaga;
}

/**
 * Calcula apenas transições, sem produzir comandos ou autorizar compensações.
 * O chamador deve validar versão, operação e identidade, e gravar os fatos,
 * a nova versão da Saga e os comandos seguintes na mesma transação local.
 */
export function reavaliarFatos(
  estadoInicial: EstadoSaga,
  pendentes: readonly FatoPendente[],
): {
  estado: EstadoSaga;
  aplicados: FatoPendente[];
  pendentes: FatoPendente[];
} {
  const ids = new Set<string>();
  for (const item of pendentes) {
    if (!item.messageId || ids.has(item.messageId))
      throw new Error('Fatos com mensagem vazia ou repetida');
    ids.add(item.messageId);
  }
  let estado = estadoInicial;
  const restantes = [...pendentes];
  const aplicados: FatoPendente[] = [];
  for (;;) {
    const indice = restantes.findIndex(
      (item) => proximoEstado(estado, item.fato) !== null,
    );
    if (indice < 0) break;
    const [item] = restantes.splice(indice, 1);
    const proximo = proximoEstado(estado, item.fato);
    if (proximo === null) throw new Error('Transição inconsistente');
    estado = proximo;
    aplicados.push(item);
  }
  return { estado, aplicados, pendentes: restantes };
}
