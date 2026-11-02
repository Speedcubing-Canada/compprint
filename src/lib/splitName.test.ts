import { describe, expect, it } from 'vitest';
import { splitName } from './splitName';

describe('splitName', () => {
  it.each([
    ['Cher', 'US', 'Cher', ''],
    ['Max Park', 'US', 'Max', 'Park'],
    ['Pedro Silva', 'BR', 'Pedro', 'Silva'],
    ['John Michael Smith', 'US', 'John Michael', 'Smith'],
    ['Mary Ann Jane Smith', 'CA', 'Mary Ann Jane', 'Smith'],
    ['Juan Pérez García', 'MX', 'Juan', 'Pérez García'],
    ['Juan Pablo Pérez García', 'ES', 'Juan Pablo', 'Pérez García'],
    ['Juan Nicolás Pinzón Martínez', 'CO', 'Juan Nicolás', 'Pinzón Martínez'],
    ['André Rodrigo César Pinheiro Monte Amado', 'BR', 'André Rodrigo César Pinheiro', 'Monte Amado'],
    ['Ludwig van Beethoven', 'DE', 'Ludwig', 'van Beethoven'],
    ['Maria da Conceição Albuquerque de Oliveira Santos Ferreira', 'BR', 'Maria', 'da Conceição Albuquerque de Oliveira Santos Ferreira'],
    ['João Pedro dos Santos', 'BR', 'João Pedro', 'dos Santos'],
    ['Jean-Philippe Gagnon-Tremblay', 'CA', 'Jean-Philippe', 'Gagnon-Tremblay'],
    ['Marie-Ève Anne Côté-Roy', 'CA', 'Marie-Ève Anne', 'Côté-Roy'],
    ['Ana  Clara   Souza', 'pt', 'Ana Clara', 'Souza'],
    ['Ana Clara de Souza', 'BR', 'Ana Clara', 'de Souza'],
    ['Ana Julia Rocha Ferreira da Silva', 'BR', 'Ana Julia', 'Rocha Ferreira da Silva'],
    ['Maria Eduarda Santos Lima', 'BR', 'Maria Eduarda', 'Santos Lima'],
    ['José Luis Ramírez', 'MX', 'José Luis', 'Ramírez'],
    ['Ana Lucia Souza', 'BR', 'Ana', 'Lucia Souza'],
    ['Ana Clara Smith', 'US', 'Ana Clara', 'Smith'],
  ])('%s (%s)', (name, country, given, surname) => {
    expect(splitName(name, country)).toEqual({ given, surname });
  });
});
