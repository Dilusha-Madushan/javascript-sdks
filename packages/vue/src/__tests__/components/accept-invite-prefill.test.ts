// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {flushPromises, mount} from '@vue/test-utils';
import {describe, expect, it, vi, type Mock} from 'vitest';
import {ref} from 'vue';
import BaseAcceptInvite from '../../components/presentation/accept-invite/BaseAcceptInvite';
import {FLOW_META_KEY, I18N_KEY} from '../../keys';

describe('BaseAcceptInvite prefilled inputs (vue)', () => {
  it('seeds the form values from the value the server returned for an input', async () => {
    const slot: Mock = vi.fn(() => []);
    const onSubmit: Mock = vi.fn().mockResolvedValue({
      data: {
        inputs: [
          {identifier: 'department', ref: 'input_1', required: false, type: 'TEXT_INPUT', value: 'Engineering'},
          {identifier: 'nickname', ref: 'input_2', required: false, type: 'TEXT_INPUT'},
        ],
        meta: {
          components: [
            {id: 'field_1', ref: 'input_1', type: 'TEXT_INPUT'},
            {id: 'field_2', ref: 'input_2', type: 'TEXT_INPUT'},
          ],
        },
      },
      flowId: 'flow-1',
      flowStatus: 'INCOMPLETE',
      type: 'VIEW',
    });

    mount(BaseAcceptInvite, {
      global: {
        provide: {
          [FLOW_META_KEY as symbol]: {meta: ref(null)},
          [I18N_KEY as symbol]: {currentLanguage: ref('en-US'), t: (key: string): string => key},
        },
      },
      props: {flowId: 'flow-1', inviteToken: 'invite-token', onSubmit},
      slots: {default: slot},
    });
    await flushPromises();

    expect(slot).toHaveBeenLastCalledWith(expect.objectContaining({values: {department: 'Engineering'}}));
  });
});
