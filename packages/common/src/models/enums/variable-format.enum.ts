import { EnumType } from '@opra/common';

export enum VariableFormat {
  Base64 = 'base64',
  Hex = 'hex',
  Url = 'url',
  Email = 'email',
  Date = 'date',
  DateTime = 'date-time',
  Time = 'time',
}

EnumType(VariableFormat, {
  name: 'VariableFormat',
  description: 'Format of string variable',
});
