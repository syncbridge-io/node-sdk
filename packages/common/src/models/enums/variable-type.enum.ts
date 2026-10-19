import { EnumType } from '@opra/common';

export enum VariableType {
  String = 'string',
  Secret = 'secret',
  Number = 'number',
  BigInt = 'bigint',
  Boolean = 'boolean',
  Nested = 'nested',
  Enum = 'enum',
}

EnumType(VariableType, {
  name: 'VariableType',
  description: 'Data type of the variable',
});
