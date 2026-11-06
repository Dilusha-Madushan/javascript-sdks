// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {describe, it, expect} from 'vitest';
import {collectPrefillValues, extractErrorMessage, transformComponents} from '../flowTransformer';

const UNIQUENESS_KEY = 'flows.executor.errors.attribute_not_unique';

/**
 * Builds a `t` stub backed by a flat bundle, mirroring how `I18nProvider` resolves keys:
 * a miss returns the key itself, and params are substituted into the resolved value.
 */
const createTranslator =
  (bundle: Record<string, string> = {}) =>
  (key: string, params?: Record<string, string | number>): string => {
    const translation: string = bundle[key] ?? key;

    if (!params) {
      return translation;
    }

    return Object.entries(params).reduce(
      (acc: string, [paramKey, paramValue]: [string, string | number]): string =>
        acc
          .replace(new RegExp(`\\{\\{\\s*param\\(\\s*${paramKey}\\s*\\)\\s*\\}\\}`, 'g'), String(paramValue))
          .replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramValue)),
      translation,
    );
  };

/**
 * The attribute-uniqueness failure as the backend sends it: an INCOMPLETE step whose `error`
 * carries the offending attribute in `params`, with `defaultValue` already substituted.
 */
const uniquenessResponse = (attribute: string) => ({
  error: {
    code: 'FET-1061',
    description: {
      defaultValue: `The provided ${attribute} is already associated with another user and expects a unique value`,
      key: `${UNIQUENESS_KEY}_desc`,
      params: {attribute},
    },
    message: {
      defaultValue: `User already exists with the provided ${attribute}`,
      key: UNIQUENESS_KEY,
      params: {attribute},
    },
  },
  executionId: 'exec-1',
  flowStatus: 'INCOMPLETE',
});

describe('extractErrorMessage', () => {
  it('substitutes the attribute name into the bundle translation', () => {
    const t = createTranslator({
      [`system.${UNIQUENESS_KEY}`]: 'User already exists with the provided {{param(attribute)}}',
    });

    expect(extractErrorMessage(uniquenessResponse('email'), t)).toBe('User already exists with the provided email');
    expect(extractErrorMessage(uniquenessResponse('username'), t)).toBe(
      'User already exists with the provided username',
    );
  });

  it('substitutes params resolved from the unprefixed key too', () => {
    const t = createTranslator({[UNIQUENESS_KEY]: 'The {{param(attribute)}} you entered is taken'});

    expect(extractErrorMessage(uniquenessResponse('email'), t)).toBe('The email you entered is taken');
  });

  it('falls back to defaultValue when the bundle template keeps an unresolved placeholder', () => {
    const t = createTranslator({
      [`system.${UNIQUENESS_KEY}`]: 'User already exists with the provided {{param(attribute)}}',
    });
    const response = uniquenessResponse('email');
    delete (response.error.message as {params?: Record<string, string>}).params;

    expect(extractErrorMessage(response, t)).toBe('User already exists with the provided email');
  });

  it('falls back to defaultValue when the key is not in any bundle', () => {
    expect(extractErrorMessage(uniquenessResponse('email'), createTranslator())).toBe(
      'User already exists with the provided email',
    );
  });

  it('falls back to the description defaultValue when the message has none', () => {
    const response = uniquenessResponse('email');
    delete (response.error.message as {defaultValue?: string}).defaultValue;

    expect(extractErrorMessage(response, createTranslator())).toBe(
      'The provided email is already associated with another user and expects a unique value',
    );
  });

  it('still supports the legacy failureReason, Error instances and the generic fallback', () => {
    const t = createTranslator({'errors.flow.generic': 'Something went wrong'});

    expect(extractErrorMessage({failureReason: 'Invalid credentials'}, t)).toBe('Invalid credentials');
    expect(extractErrorMessage(new Error('Network down'), t)).toBe('Network down');
    expect(extractErrorMessage(undefined, t)).toBe('Something went wrong');
  });
});

describe('prefill values', () => {
  const t = createTranslator();

  const promptResponse = (inputs: Record<string, unknown>[], components: Record<string, unknown>[]) => ({
    data: {inputs, meta: {components}},
  });

  it('copies the input value onto the component and still maps the ref to the identifier', () => {
    const response = promptResponse(
      [{identifier: 'department', ref: 'input_1', required: true, type: 'TEXT_INPUT', value: 'Engineering'}],
      [{id: 'field_1', ref: 'input_1', type: 'TEXT_INPUT'}],
    );

    const [component] = transformComponents(response, t, false);

    expect(component.ref).toBe('department');
    expect(component.value).toBe('Engineering');
  });

  it('copies the value onto nested components', () => {
    const response = promptResponse(
      [{identifier: 'department', ref: 'input_1', required: false, type: 'TEXT_INPUT', value: 'Engineering'}],
      [{components: [{id: 'field_1', ref: 'input_1', type: 'TEXT_INPUT'}], id: 'block_1', type: 'BLOCK'}],
    );

    const [block] = transformComponents(response, t, false);

    expect(block.components?.[0].value).toBe('Engineering');
  });

  it('leaves out empty values, inputs without a value, and password and OTP inputs', () => {
    const response = promptResponse(
      [
        {identifier: 'empty', ref: 'input_1', required: false, type: 'TEXT_INPUT', value: ''},
        {identifier: 'none', ref: 'input_2', required: false, type: 'TEXT_INPUT'},
        {identifier: 'password', ref: 'input_3', required: true, type: 'PASSWORD_INPUT', value: 'secret'},
        {identifier: 'otp', ref: 'input_4', required: true, type: 'OTP_INPUT', value: '123456'},
      ],
      [
        {id: 'field_1', ref: 'input_1', type: 'TEXT_INPUT'},
        {id: 'field_2', ref: 'input_2', type: 'TEXT_INPUT'},
        {id: 'field_3', ref: 'input_3', type: 'PASSWORD_INPUT'},
        {id: 'field_4', ref: 'input_4', type: 'OTP_INPUT'},
      ],
    );

    const components = transformComponents(response, t, false);

    components.forEach((component) => expect(component.value).toBeUndefined());
  });

  it('collects the values of nested components by identifier', () => {
    const values = collectPrefillValues([
      {
        components: [{id: 'field_1', ref: 'department', type: 'TEXT_INPUT', value: 'Engineering'}],
        id: 'block_1',
        type: 'BLOCK',
      },
      {id: 'field_2', ref: 'username', type: 'TEXT_INPUT'},
    ]);

    expect(values).toEqual({department: 'Engineering'});
  });
});
