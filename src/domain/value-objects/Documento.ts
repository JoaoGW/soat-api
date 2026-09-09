import { ValueObject } from '../../shared/domain/ValueObject';
import { DocumentoInvalidoError } from '../errors/DocumentoInvalidoError';

interface DocumentoProps {
  valor: string;
  tipo: 'CPF' | 'CNPJ';
}

export class Documento extends ValueObject<DocumentoProps> {
  constructor(valor: string) {
    const limpo = valor.replace(/\D/g, '');
    const tipo =
      limpo.length === 11 ? 'CPF' : limpo.length === 14 ? 'CNPJ' : null;
    if (!tipo || !Documento.validar(limpo, tipo))
      throw new DocumentoInvalidoError();
    super({ valor: limpo, tipo });
  }

  get valor(): string {
    return this.props.valor;
  }
  get tipo(): string {
    return this.props.tipo;
  }

  private static validar(valor: string, tipo: 'CPF' | 'CNPJ'): boolean {
    if (tipo === 'CPF') return Documento.validarCPF(valor);
    return Documento.validarCNPJ(valor);
  }

  private static validarCPF(cpf: string): boolean {
    if (/^(\d)\1+$/.test(cpf)) return false;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
    let resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf[9])) return false;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    return resto === parseInt(cpf[10]);
  }

  private static validarCNPJ(cnpj: string): boolean {
    if (/^(\d)\1+$/.test(cnpj)) return false;
    const calc = (c: string, arr: number[]) =>
      arr.reduce((s, p, i) => s + parseInt(c[i]) * p, 0);
    const r1 = calc(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) % 11;
    const d1 = r1 < 2 ? 0 : 11 - r1;
    if (d1 !== parseInt(cnpj[12])) return false;
    const r2 = calc(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) % 11;
    const d2 = r2 < 2 ? 0 : 11 - r2;
    return d2 === parseInt(cnpj[13]);
  }
}
