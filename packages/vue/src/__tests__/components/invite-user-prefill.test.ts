// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {flushPromises, mount} from '@vue/test-utils';
import {describe, expect, it, vi, type Mock} from 'vitest';
import {ref} from 'vue';
import BaseInviteUser from '../../components/presentation/invite-user/BaseInviteUser';
import {FLOW_META_KEY, I18N_KEY} from '../../keys';

describe('BaseInviteUser prefilled inputs (vue)', () => {
  it('seeds the form values from the prefill value of an input component', async () => {
    const slot: Mock = vi.fn(() => []);
    const onInitialize: Mock = vi.fn().mockResolvedValue({
      data: {
        components: [
          {id: 'department_input', ref: 'department', type: 'TEXT_INPUT', value: 'Engineering'},
          {id: 'email_input', ref: 'email', type: 'TEXT_INPUT'},
        ],
      },
      executionId: 'exec-1',
      flowStatus: 'INCOMPLETE',
    });

    mount(BaseInviteUser, {
      global: {
        provide: {
          [FLOW_META_KEY as symbol]: {meta: ref(null)},
          [I18N_KEY as symbol]: {currentLanguage: ref('en-US'), t: (key: string): string => key},
        },
      },
      props: {onInitialize, onSubmit: vi.fn()},
      slots: {default: slot},
    });
    await flushPromises();

    expect(slot).toHaveBeenLastCalledWith(expect.objectContaining({values: {department: 'Engineering'}}));
  });
});
