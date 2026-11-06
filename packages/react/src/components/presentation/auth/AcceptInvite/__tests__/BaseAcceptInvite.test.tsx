// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {cleanup, render, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import I18nProvider from '../../../../../contexts/I18n/I18nProvider';
import ThemeProvider from '../../../../../contexts/Theme/ThemeProvider';
import ThunderIDContext, {ThunderIDContextProps} from '../../../../../contexts/ThunderID/ThunderIDContext';
import BaseAcceptInvite from '../BaseAcceptInvite';

const thunderIDContext: ThunderIDContextProps = {
  getStorageManager: vi.fn(() =>
    Promise.resolve({
      getTemporaryData: vi.fn(() => Promise.resolve({})),
      removeTemporaryDataParameter: vi.fn(),
      setTemporaryDataParameter: vi.fn(),
    }),
  ),
  isInitialized: true,
  isLoading: false,
  vendor: 'thunderid',
} as unknown as ThunderIDContextProps;

describe('BaseAcceptInvite', () => {
  afterEach(() => {
    cleanup();
  });

  it('seeds the form values from the value the server returned for an input', async () => {
    const onSubmit = vi.fn().mockResolvedValue({
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
      executionId: 'exec-1',
      flowStatus: 'INCOMPLETE',
      type: 'VIEW',
    });
    const renderChild = vi.fn(() => <div />);

    render(
      <ThunderIDContext.Provider value={thunderIDContext}>
        <I18nProvider>
          <ThemeProvider>
            <BaseAcceptInvite executionId="exec-1" inviteToken="invite-token" onSubmit={onSubmit}>
              {renderChild}
            </BaseAcceptInvite>
          </ThemeProvider>
        </I18nProvider>
      </ThunderIDContext.Provider>,
    );

    await waitFor(() => {
      expect(renderChild).toHaveBeenLastCalledWith(expect.objectContaining({values: {department: 'Engineering'}}));
    });
  });
});
