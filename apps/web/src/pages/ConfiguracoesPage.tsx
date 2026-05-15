import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiClientError, api } from '../api/client';
import type { Role } from '../auth/AuthProvider';
import {
  ROLE_LABELS,
  ROLE_VALUES,
  type AppUser,
  type Package,
  type Subject,
  type Unit,
} from '../api/types';
import { formatCents, formatDate, parseReaisToCents } from '../lib/format';

type PackageForm = {
  name: string;
  classCount: string;
  price: string;
  validityDays: string;
};

type UserForm = {
  name: string;
  email: string;
  password: string;
  roles: Role[];
  subjectId: string;
  unitId: string;
};

const EMPTY_PACKAGE: PackageForm = { name: '', classCount: '', price: '', validityDays: '0' };
const EMPTY_USER: UserForm = {
  name: '',
  email: '',
  password: '',
  roles: [],
  subjectId: '',
  unitId: '',
};

export function ConfiguracoesPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [packageForm, setPackageForm] = useState<PackageForm>(EMPTY_PACKAGE);
  const [userForm, setUserForm] = useState<UserForm>(EMPTY_USER);
  const [error, setError] = useState('');
  const [savingPackage, setSavingPackage] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string>();
  const [pendingPackageId, setPendingPackageId] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [packageList, userList, subjectList, unitList] = await Promise.all([
        api<{ data: Package[] }>('/api/packages'),
        api<{ data: AppUser[] }>('/api/users'),
        api<{ data: Subject[] }>('/api/subjects'),
        api<{ data: Unit[] }>('/api/units'),
      ]);
      setPackages(packageList.data);
      setUsers(userList.data);
      setSubjects(subjectList.data);
      setUnits(unitList.data.filter((item) => item.active));
    } catch {
      setError('Nao foi possivel carregar as configuracoes.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updatePackageField(field: keyof PackageForm, value: string) {
    setPackageForm((current) => ({ ...current, [field]: value }));
  }

  function updateUserField(
    field: 'name' | 'email' | 'password' | 'subjectId' | 'unitId',
    value: string,
  ) {
    setUserForm((current) => ({ ...current, [field]: value }));
  }

  function toggleRole(role: Role) {
    setUserForm((current) => ({
      ...current,
      roles: current.roles.includes(role)
        ? current.roles.filter((item) => item !== role)
        : [...current.roles, role],
    }));
  }

  async function handleCreatePackage(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSavingPackage(true);

    try {
      await api<{ data: Package }>('/api/packages', {
        method: 'POST',
        body: JSON.stringify({
          name: packageForm.name,
          classCount: Number(packageForm.classCount),
          priceCents: parseReaisToCents(packageForm.price),
          validityDays: Number(packageForm.validityDays),
        }),
      });
      setPackageForm(EMPTY_PACKAGE);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel criar o pacote.');
    } finally {
      setSavingPackage(false);
    }
  }

  async function handleCreateUser(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (userForm.roles.length === 0) {
      setError('Selecione ao menos um papel para o usuario.');
      return;
    }

    const isProfessor = userForm.roles.includes('professor');
    if (isProfessor && !userForm.subjectId) {
      setError('Professor precisa de uma materia vinculada.');
      return;
    }

    setSavingUser(true);
    try {
      await api<{ data: AppUser }>('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: userForm.name,
          email: userForm.email,
          password: userForm.password,
          roles: userForm.roles,
          subjectId: isProfessor ? userForm.subjectId : undefined,
          unitId: userForm.unitId || undefined,
        }),
      });
      setUserForm(EMPTY_USER);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel criar o usuario.');
    } finally {
      setSavingUser(false);
    }
  }

  async function handleTogglePackage(item: Package) {
    setPendingPackageId(item.id);
    setError('');

    try {
      const response = await api<{ data: Package }>(`/api/packages/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !item.active }),
      });
      setPackages((current) =>
        current.map((pkg) => (pkg.id === response.data.id ? response.data : pkg)),
      );
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel atualizar o pacote.');
    } finally {
      setPendingPackageId(undefined);
    }
  }

  async function handleToggleActive(user: AppUser) {
    setPendingUserId(user.id);
    setError('');

    try {
      const response = await api<{ data: AppUser }>(`/api/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !user.active }),
      });
      setUsers((current) =>
        current.map((item) => (item.id === response.data.id ? response.data : item)),
      );
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Nao foi possivel atualizar o usuario.');
    } finally {
      setPendingUserId(undefined);
    }
  }

  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Configuracoes</p>
          <h1>Administracao</h1>
        </div>
      </header>

      {error && <p className="form-error">{error}</p>}

      <section className="form-card">
        <h2>Novo pacote</h2>
        <p className="muted-text">
          Alteracao de preco cria um novo pacote vigente a partir de hoje. O historico anterior
          nao e reescrito.
        </p>
        <form className="grid-form" onSubmit={handleCreatePackage}>
          <label>
            Nome
            <input
              value={packageForm.name}
              onChange={(event) => updatePackageField('name', event.target.value)}
              required
            />
          </label>
          <label>
            Quantidade de aulas
            <input
              type="number"
              min={1}
              max={1000}
              value={packageForm.classCount}
              onChange={(event) => updatePackageField('classCount', event.target.value)}
              required
            />
          </label>
          <label>
            Preco (R$)
            <input
              inputMode="decimal"
              value={packageForm.price}
              onChange={(event) => updatePackageField('price', event.target.value)}
              required
            />
          </label>
          <label>
            Validade (dias)
            <input
              type="number"
              min={0}
              max={3650}
              value={packageForm.validityDays}
              onChange={(event) => updatePackageField('validityDays', event.target.value)}
              required
            />
          </label>
          <div className="grid-form-actions">
            <button type="submit" disabled={savingPackage}>
              {savingPackage ? 'Salvando...' : 'Criar pacote'}
            </button>
          </div>
        </form>
      </section>

      <section className="table-card">
        <div className="table-card-header">
          <div>
            <strong>Pacotes e precos</strong>
            <span>Vigencia controlada por data</span>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Pacote</th>
              <th>Aulas</th>
              <th>Preco</th>
              <th>Validade</th>
              <th>Vigente desde</th>
              <th>Status</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {packages.length === 0 && (
              <tr>
                <td colSpan={7}>Nenhum pacote cadastrado.</td>
              </tr>
            )}
            {packages.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.classCount}</td>
                <td>{formatCents(item.priceCents)}</td>
                <td>{item.validityDays} dias</td>
                <td>{formatDate(item.effectiveFrom)}</td>
                <td>{item.active ? 'ativo' : 'inativo'}</td>
                <td>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={pendingPackageId === item.id}
                    onClick={() => void handleTogglePackage(item)}
                  >
                    {pendingPackageId === item.id
                      ? 'Salvando...'
                      : item.active
                        ? 'Desativar'
                        : 'Ativar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="form-card">
        <h2>Novo usuario</h2>
        <p className="muted-text">
          Defina a senha inicial e repasse ao usuario. Use os papeis para liberar o acesso de cada
          area (professor enxerga apenas as proprias aulas).
        </p>
        <form className="grid-form" onSubmit={handleCreateUser}>
          <label>
            Nome
            <input
              value={userForm.name}
              onChange={(event) => updateUserField('name', event.target.value)}
              required
            />
          </label>
          <label>
            E-mail
            <input
              type="email"
              value={userForm.email}
              onChange={(event) => updateUserField('email', event.target.value)}
              required
            />
          </label>
          <label>
            Senha inicial
            <input
              type="password"
              minLength={12}
              value={userForm.password}
              onChange={(event) => updateUserField('password', event.target.value)}
              required
            />
          </label>
          <div className="role-options">
            {ROLE_VALUES.map((role) => (
              <label key={role}>
                <input
                  type="checkbox"
                  checked={userForm.roles.includes(role)}
                  onChange={() => toggleRole(role)}
                />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </div>
          {userForm.roles.includes('professor') && (
            <label>
              Materia do professor
              <select
                value={userForm.subjectId}
                onChange={(event) => updateUserField('subjectId', event.target.value)}
                required
              >
                <option value="">Selecione</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Unidade (opcional)
            <select
              value={userForm.unitId}
              onChange={(event) => updateUserField('unitId', event.target.value)}
            >
              <option value="">Acesso a todas as unidades</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid-form-actions">
            <button type="submit" disabled={savingUser}>
              {savingUser ? 'Salvando...' : 'Criar usuario'}
            </button>
          </div>
        </form>
      </section>

      <section className="table-card">
        <div className="table-card-header">
          <div>
            <strong>Usuarios e permissoes</strong>
            <span>Ative ou desative o acesso de cada usuario</span>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Papeis</th>
              <th>Materia</th>
              <th>Unidade</th>
              <th>Status</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={7}>Nenhum usuario encontrado.</td>
              </tr>
            )}
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.roles.map((role) => ROLE_LABELS[role]).join(', ')}</td>
                <td>{user.subject?.name ?? '-'}</td>
                <td>{user.unit?.name ?? 'Todas'}</td>
                <td>{user.active ? 'ativo' : 'inativo'}</td>
                <td>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={pendingUserId === user.id}
                    onClick={() => void handleToggleActive(user)}
                  >
                    {pendingUserId === user.id
                      ? 'Salvando...'
                      : user.active
                        ? 'Desativar'
                        : 'Ativar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
