import { DocumentoInvalidoError } from '../errors/DocumentoInvalidoError';
import { Documento } from './Documento';

describe('Documento', () => {
  it('deve aceitar CPF valido', () => {
    const documento = new Documento('529.982.247-25');

    expect(documento.valor).toBe('52998224725');
    expect(documento.tipo).toBe('CPF');
  });

  it('deve rejeitar CPF invalido', () => {
    expect(() => new Documento('529.982.247-24')).toThrow(
      DocumentoInvalidoError,
    );
  });

  it('deve aceitar CNPJ valido', () => {
    const documento = new Documento('04.252.011/0001-10');

    expect(documento.valor).toBe('04252011000110');
    expect(documento.tipo).toBe('CNPJ');
  });

  it('deve rejeitar CNPJ invalido', () => {
    expect(() => new Documento('04.252.011/0001-11')).toThrow(
      DocumentoInvalidoError,
    );
  });

  it('deve rejeitar sequencia repetida', () => {
    expect(() => new Documento('111.111.111-11')).toThrow(
      DocumentoInvalidoError,
    );
    expect(() => new Documento('11.111.111/1111-11')).toThrow(
      DocumentoInvalidoError,
    );
  });
});
