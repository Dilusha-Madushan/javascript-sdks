// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {mount} from '@vue/test-utils';
import {describe, expect, it, vi, type Mock} from 'vitest';
import {ref} from 'vue';
import BaseSignIn from '../../components/auth/sign-in/BaseSignIn';
import {FLOW_KEY, FLOW_META_KEY, I18N_KEY} from '../../keys';

describe('BaseSignIn', () => {
  it('exposes the step additionalData to the default slot', () => {
    const slot: Mock = vi.fn(() => []);
    mount(BaseSignIn, {
      global: {
        provide: {
          [FLOW_KEY as symbol]: {
            addMessage: vi.fn(),
            clearMessages: vi.fn(),
            messages: ref([]),
            subtitle: ref(null),
            title: ref(null),
          },
          [FLOW_META_KEY as symbol]: {meta: ref(null)},
          [I18N_KEY as symbol]: {currentLanguage: ref('en-US'), t: (key: string): string => key},
        },
      },
      props: {additionalData: {linkingPromptDetails: '[]'}, components: []},
      slots: {default: slot},
    });

    expect(slot).toHaveBeenLastCalledWith(expect.objectContaining({additionalData: {linkingPromptDetails: '[]'}}));
  });

  it('seeds the form values from the prefill value of an input component', () => {
    const slot: Mock = vi.fn(() => []);
    mount(BaseSignIn, {
      global: {
        provide: {
          [FLOW_KEY as symbol]: {
            addMessage: vi.fn(),
            clearMessages: vi.fn(),
            messages: ref([]),
            subtitle: ref(null),
            title: ref(null),
          },
          [FLOW_META_KEY as symbol]: {meta: ref(null)},
          [I18N_KEY as symbol]: {currentLanguage: ref('en-US'), t: (key: string): string => key},
        },
      },
      props: {
        components: [
          {id: 'field_1', ref: 'department', type: 'TEXT_INPUT', value: 'Engineering'},
          {id: 'field_2', ref: 'username', type: 'TEXT_INPUT'},
        ],
      },
      slots: {default: slot},
    });

    expect(slot).toHaveBeenLastCalledWith(expect.objectContaining({values: {department: 'Engineering', username: ''}}));
  });
});
