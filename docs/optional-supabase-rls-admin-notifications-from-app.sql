-- Opcional: permite que o app mobile envie notificações com a mesma lógica da API Next
-- (`/api/admin/notifications/send`), usando apenas o JWT do usuário admin.
--
-- Hoje a tabela `teacher_notifications` tem uma política de INSERT que é sempre falsa
-- (só inserts via service role no servidor). Esta política PERMISSIVE extra faz OR com a
-- existente: admins autenticados passam a poder inserir linhas de `admin_announcement`.
--
-- Execute no SQL Editor do Supabase do projeto Eluency (não altera o código do site).

DROP POLICY IF EXISTS "Admins insert teacher_notifications from app" ON public.teacher_notifications;

CREATE POLICY "Admins insert teacher_notifications from app"
  ON public.teacher_notifications
  FOR INSERT
  WITH CHECK (
    type = 'admin_announcement'
    AND EXISTS (
      SELECT 1
      FROM public.teachers t
      WHERE t.user_id = auth.uid()
        AND t.active = true
        AND lower(t.role::text) = 'admin'
    )
  );
