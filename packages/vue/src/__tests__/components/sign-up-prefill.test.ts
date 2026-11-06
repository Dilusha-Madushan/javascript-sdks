// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {flushPromises, mount} from '@vue/test-utils';
import {describe, expect, it, vi, type Mock} from 'vitest';
import {ref} from 'vue';
import BaseSignUp from '../../components/auth/sign-up/BaseSignUp';
import {FLOW_META_KEY, I18N_KEY} from '../../keys';

describe('BaseSignUp prefilled inputs (vue)', () => {
  it('seeds the form values from the value the server returned for an input', async () => {
    const slot: Mock = vi.fn(() => []);
    const onInitialize: Mock = vi.fn().mockResolvedValue({
      data: {
        inputs: [
          {identifier: 'department', ref: 'input_1', required: false, type: 'TEXT_INPUT', value: 'Engineering'},
          {identifier: 'email', ref: 'input_2', required: true, type: 'EMAIL_INPUT'},
        ],
        meta: {
          components: [
            {id: 'field_1', ref: 'input_1', type: 'TEXT_INPUT'},
            {id: 'field_2', ref: 'input_2', type: 'EMAIL_INPUT'},
          ],
        },
      },
      executionId: 'exec-1',
      flowStatus: 'INCOMPLETE',
    });

    mount(BaseSignUp, {
      global: {
        provide: {
          [FLOW_META_KEY as symbol]: {meta: ref(null)},
          [I18N_KEY as symbol]: {currentLanguage: ref('en-US'), t: (key: string): string => key},
        },
      },
      props: {isInitialized: true, onInitialize, onSubmit: vi.fn()},
      slots: {default: slot},
    });
    await flushPromises();

    expect(slot).toHaveBeenLastCalledWith(expect.objectContaining({values: {department: 'Engineering', email: ''}}));
  });
});
