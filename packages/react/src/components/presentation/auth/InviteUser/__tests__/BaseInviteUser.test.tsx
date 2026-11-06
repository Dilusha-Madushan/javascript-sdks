// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {act, render, waitFor} from '@testing-library/react';
import {createTheme, EmbeddedFlowComponentType, FetchAuthFlows, FetchUsers, FetchUserTypes} from '@thunderid/browser';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import BaseInviteUser from '../BaseInviteUser';

const mocks = vi.hoisted(() => ({
  renderInviteUserComponents: vi.fn(),
}));

vi.mock('../../AuthOptionFactory', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  renderInviteUserComponents: mocks.renderInviteUserComponents,
}));
vi.mock('../../../../../contexts/Theme/useTheme', () => ({default: () => ({theme: createTheme()})}));
vi.mock('../../../../../contexts/ThunderID/useThunderID', () => ({
  default: () => ({getStorageManager: vi.fn(), isInitialized: true, meta: null}),
}));
vi.mock('../../../../../hooks/useTranslation', () => ({
  default: () => ({t: (key: string): string => key}),
}));

const pickerInput = (type: EmbeddedFlowComponentType): {id: string; ref: string; type: EmbeddedFlowComponentType} => ({
  id: 'owner_input',
  ref: 'owner',
  type,
});
const ownerInput = pickerInput(EmbeddedFlowComponentType.UserSelect);

describe('BaseInviteUser USER_SELECT data source', () => {
  beforeEach(() => {
    mocks.renderInviteUserComponents.mockReset().mockReturnValue([]);
  });

  it('gives the flow renderer the data source it was supplied', async () => {
    const fetchUsers: FetchUsers = vi.fn();
    const onInitialize = vi.fn().mockResolvedValue({
      data: {components: [ownerInput]},
      executionId: 'exec-1',
      flowStatus: 'INCOMPLETE',
    });

    render(<BaseInviteUser fetchUsers={fetchUsers} onInitialize={onInitialize} onSubmit={vi.fn()} />);

    await waitFor(() => expect(mocks.renderInviteUserComponents).toHaveBeenCalled());
    const options = mocks.renderInviteUserComponents.mock.calls.at(-1)![8] as {fetchUsers?: FetchUsers};
    expect(options.fetchUsers).toBe(fetchUsers);
  });

  it('gives the flow renderer the flow and user type data sources it was supplied', async () => {
    const fetchAuthFlows: FetchAuthFlows = vi.fn();
    const fetchUserTypes: FetchUserTypes = vi.fn();
    const onInitialize = vi.fn().mockResolvedValue({
      data: {components: [pickerInput(EmbeddedFlowComponentType.AuthFlowSelect)]},
      executionId: 'exec-1',
      flowStatus: 'INCOMPLETE',
    });

    render(
      <BaseInviteUser
        fetchAuthFlows={fetchAuthFlows}
        fetchUserTypes={fetchUserTypes}
        onInitialize={onInitialize}
        onSubmit={vi.fn()}
      />,
    );

    await waitFor(() => expect(mocks.renderInviteUserComponents).toHaveBeenCalled());
    const options = mocks.renderInviteUserComponents.mock.calls.at(-1)![8] as {
      fetchAuthFlows?: FetchAuthFlows;
      fetchUserTypes?: FetchUserTypes;
    };
    expect(options.fetchAuthFlows).toBe(fetchAuthFlows);
    expect(options.fetchUserTypes).toBe(fetchUserTypes);
  });
});

describe('BaseInviteUser flow text', () => {
  beforeEach(() => {
    mocks.renderInviteUserComponents.mockReset().mockReturnValue([]);
  });

  it('shows the heading of the step with its translation resolved', async () => {
    const onInitialize = vi.fn().mockResolvedValue({
      data: {
        components: [{id: 'heading', label: '{{ t(forms.owner.title) }}', type: 'TEXT', variant: 'HEADING_1'}],
      },
      executionId: 'exec-1',
      flowStatus: 'INCOMPLETE',
    });
    const children = vi.fn().mockReturnValue(null);

    render(
      <BaseInviteUser onInitialize={onInitialize} onSubmit={vi.fn()}>
        {children}
      </BaseInviteUser>,
    );

    await waitFor(() => expect(children).toHaveBeenCalledWith(expect.objectContaining({title: 'forms.owner.title'})));
  });

  it('gives the flow renderer the flow metadata and the translation function, so translated labels resolve', async () => {
    const onInitialize = vi.fn().mockResolvedValue({
      data: {components: [ownerInput]},
      executionId: 'exec-1',
      flowStatus: 'INCOMPLETE',
    });

    render(<BaseInviteUser onInitialize={onInitialize} onSubmit={vi.fn()} />);

    await waitFor(() => expect(mocks.renderInviteUserComponents).toHaveBeenCalled());
    const options = mocks.renderInviteUserComponents.mock.calls.at(-1)![8] as {t?: (key: string) => string};
    expect(options).toHaveProperty('meta');
    expect(options.t?.('some.key')).toBe('some.key');
  });
});

describe('BaseInviteUser picker load errors', () => {
  beforeEach(() => {
    mocks.renderInviteUserComponents.mockReset().mockReturnValue([]);
  });

  it('gives the flow renderer its own onError prop for failed picker loads', async () => {
    const onError = vi.fn();
    const onInitialize = vi.fn().mockResolvedValue({
      data: {components: [ownerInput]},
      executionId: 'exec-1',
      flowStatus: 'INCOMPLETE',
    });

    render(<BaseInviteUser onError={onError} onInitialize={onInitialize} onSubmit={vi.fn()} />);

    await waitFor(() => expect(mocks.renderInviteUserComponents).toHaveBeenCalled());
    const options = mocks.renderInviteUserComponents.mock.calls.at(-1)![8] as {onPickerError?: (error: Error) => void};
    expect(options.onPickerError).toBe(onError);
  });
});

describe.each([
  EmbeddedFlowComponentType.UserSelect,
  EmbeddedFlowComponentType.AuthFlowSelect,
  EmbeddedFlowComponentType.UserTypeSelect,
])('BaseInviteUser %s required-field validation', (pickerType: EmbeddedFlowComponentType) => {
  interface RenderOptions {
    onSubmit: (component: unknown) => Promise<void>;
  }

  const mountWithRequiredOwner = async (required: boolean) => {
    const onSubmit = vi.fn().mockResolvedValue({data: {components: []}, flowStatus: 'INCOMPLETE'});
    const onInitialize = vi.fn().mockResolvedValue({
      data: {
        components: [
          {...pickerInput(pickerType), label: 'Owner', required},
          {id: 'invite_action', type: 'ACTION'},
        ],
      },
      executionId: 'exec-1',
      flowStatus: 'INCOMPLETE',
    });

    render(<BaseInviteUser fetchUsers={vi.fn()} onInitialize={onInitialize} onSubmit={onSubmit} />);
    await waitFor(() => expect(mocks.renderInviteUserComponents).toHaveBeenCalled());

    const lastCall = (): unknown[] => mocks.renderInviteUserComponents.mock.calls.at(-1)!;
    const submit = (): Promise<void> =>
      act(async () => {
        await (lastCall()[8] as RenderOptions).onSubmit({id: 'invite_action'});
      });

    return {lastCall, onSubmit, submit};
  };

  beforeEach(() => {
    mocks.renderInviteUserComponents.mockReset().mockReturnValue([]);
  });

  it('blocks submission and surfaces a field error when a required picker is empty', async () => {
    const {lastCall, onSubmit, submit} = await mountWithRequiredOwner(true);

    await submit();

    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(lastCall()[3]).toHaveProperty('owner'));
  });

  it('lets an optional picker stay empty', async () => {
    const {onSubmit, submit} = await mountWithRequiredOwner(false);

    await submit();

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('lets a required picker through once a user has been chosen', async () => {
    const {lastCall, onSubmit, submit} = await mountWithRequiredOwner(true);

    act(() => {
      (lastCall()[7] as (name: string, value: string) => void)('owner', 'user-1');
    });
    await submit();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const expectedInputs: unknown = expect.objectContaining({owner: 'user-1'});
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({inputs: expectedInputs}));
  });
});

describe('BaseInviteUser prefilled inputs', () => {
  beforeEach(() => {
    mocks.renderInviteUserComponents.mockReset().mockReturnValue([]);
  });

  it('seeds the form values from the prefill value of an input component', async () => {
    const onInitialize = vi.fn().mockResolvedValue({
      data: {
        components: [
          {id: 'department_input', ref: 'department', type: EmbeddedFlowComponentType.TextInput, value: 'Engineering'},
          {id: 'email_input', ref: 'email', type: EmbeddedFlowComponentType.TextInput},
        ],
      },
      executionId: 'exec-1',
      flowStatus: 'INCOMPLETE',
    });
    const children = vi.fn().mockReturnValue(null);

    render(
      <BaseInviteUser onInitialize={onInitialize} onSubmit={vi.fn()}>
        {children}
      </BaseInviteUser>,
    );

    await waitFor(() =>
      expect(children).toHaveBeenLastCalledWith(expect.objectContaining({values: {department: 'Engineering'}})),
    );
  });
});
