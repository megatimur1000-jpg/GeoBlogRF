import React, { useEffect, useState } from 'react';
import { MirrorGradientContainer } from '../components/MirrorGradientProvider';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../api/apiClient';

interface SubscriptionAdmin {
  id: number;
  plan: string;
  status: string;
  currentPeriodEnd: string;
  user: { id: number; email: string; name?: string };
}

export default function AdminSubscriptionsPage() {
  const { user } = useAuth() || { user: null } as any;
  const isAllowed = !!user && user.role === 'admin';
  const [subscriptions, setSubscriptions] = useState<SubscriptionAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSubscriptions = async () => {
      try {
        setLoading(true);
        const resp = await apiClient.get('/admin/subscriptions');
        if (resp && resp.data) setSubscriptions(resp.data as SubscriptionAdmin[]);
      } catch (err: any) {
        setError(err?.message || 'Ошибка при загрузке подписок');
      } finally {
        setLoading(false);
      }
    };
    fetchSubscriptions();
  }, []);

  if (!isAllowed) {
    return (
      <MirrorGradientContainer className="page-layout-container page-container">
        <div className="page-main-area">
          <div className="page-content-wrapper">
            <div className="page-main-panel relative">
              <div className="p-6 max-w-xl mx-auto">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Нет доступа</h1>
                <p className="text-gray-600">Требуется учётная запись администратора</p>
              </div>
            </div>
          </div>
        </div>
      </MirrorGradientContainer>
    );
  }

  return (
    <MirrorGradientContainer className="page-layout-container page-container">
      <div className="page-main-area">
        <div className="page-content-wrapper">
          <div className="page-main-panel relative">
            <div className="p-6 max-w-7xl mx-auto">
              <h2 className="text-2xl font-semibold mb-4">Подписки пользователей</h2>

              {loading && <div className="text-gray-600">Загрузка...</div>}
              {error && <div className="text-red-600">{error}</div>}

              {!loading && !error && (
                <div className="overflow-x-auto">
                  <table className="w-full table-auto border-collapse">
                    <thead>
                      <tr className="text-left">
                        <th className="px-4 py-2">ID</th>
                        <th className="px-4 py-2">План</th>
                        <th className="px-4 py-2">Статус</th>
                        <th className="px-4 py-2">Окончание</th>
                        <th className="px-4 py-2">Пользователь</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subscriptions.map((s) => (
                        <tr key={s.id} className="border-t">
                          <td className="px-4 py-2">{s.id}</td>
                          <td className="px-4 py-2">{s.plan}</td>
                          <td className="px-4 py-2">{s.status}</td>
                          <td className="px-4 py-2">{new Date(s.currentPeriodEnd).toLocaleString()}</td>
                          <td className="px-4 py-2">{s.user?.email}</td>
                        </tr>
                      ))}
                      {subscriptions.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-gray-600">Подписок не найдено</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </MirrorGradientContainer>
  );
}
