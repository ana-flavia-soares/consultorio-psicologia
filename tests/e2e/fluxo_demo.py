"""Teste de ponta a ponta do modo demonstração.
Como rodar: npm run build:demo && npx vite preview  (em outro terminal)
            pip install playwright && playwright install chromium
            python3 tests/e2e/fluxo_demo.py
Os prints das telas ficam na pasta atual.
"""
import asyncio, re, sys
from playwright.async_api import async_playwright, expect

import os
BASE = os.environ.get('BASE_URL', 'http://localhost:4173/')
PASS = 'chuva-de-outono-no-cafe-27'
NEW = 'tarde-de-domingo-com-pao-93'
ok = []

def check(cond, name):
    if not cond:
        raise AssertionError('FALHOU: ' + name)
    ok.append(name); print('OK  ', name)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900})
        pg = await ctx.new_page()
        errors, csp = [], []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: (csp.append(m.text) if 'Content Security Policy' in m.text or 'Refused' in m.text else None) or (errors.append(m.text) if m.type == 'error' else None))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(BASE)

        # Login + MFA
        await pg.get_by_role('button', name='Entrar').click()
        await pg.get_by_role('button', name='Começar').click()
        await pg.get_by_label('Código de 6 números').fill('000000')
        await pg.get_by_role('button', name='Ativar').click()
        await expect(pg.get_by_role('alert')).to_contain_text('Código inválido')
        check(True, 'Código errado de duas etapas é recusado')
        await pg.get_by_label('Código de 6 números').fill('123456')
        await pg.get_by_role('button', name='Ativar').click()

        # Cofre
        await pg.get_by_label('Senha do cofre').fill('curta')
        check(await pg.get_by_text('Use pelo menos 12 caracteres.').is_visible(), 'Senha fraca do cofre mostra aviso')
        await pg.get_by_label('Senha do cofre').fill(PASS)
        await pg.get_by_label('Repita a senha').fill(PASS)
        await pg.get_by_role('button', name='Criar cofre').click()
        rk = (await pg.get_by_label('Chave de recuperação').inner_text()).strip()
        check(re.fullmatch(r'([0-9A-Z]{4}-){12}[0-9A-Z]{4}', rk) is not None, 'Chave de recuperação mostrada no formato certo')
        cont = pg.get_by_role('button', name='Continuar')
        check(await cont.is_disabled(), 'Não continua sem confirmar que guardou a chave')
        await pg.get_by_role('checkbox').check()
        await pg.get_by_label('Para confirmar').fill(rk[-4:])
        await cont.click()
        await pg.screenshot(path='e2e_01_hoje.png', full_page=True)

        # Hoje
        await expect(pg.get_by_role('heading', level=1)).to_be_visible()
        check(await pg.get_by_text('Marina Alves').first.is_visible(), 'Nomes fictícios aparecem descriptografados')

        # Sessão: anotação existente, nova versão
        await pg.get_by_role('button', name='Abrir sessão').first.click()
        ta = pg.locator('#anot')
        await expect(ta).to_have_value(re.compile('Evolução'))
        check(True, 'Anotação existente abre descriptografada')
        await ta.fill((await ta.input_value()) + '\nObservação adicional de teste.')
        await pg.get_by_role('button', name='Salvar anotação').click()
        await expect(pg.get_by_text(re.compile(r'Versão 2 salva'))).to_be_visible()
        check(True, 'Editar a anotação cria a versão 2')
        await pg.get_by_role('button', name=re.compile(r'^v1 ')).click()
        check('Observação adicional' not in await pg.locator('.readonly-note').first.inner_text(), 'Versão 1 continua sem a edição')
        await pg.get_by_role('button', name='Voltar para a versão atual').click()
        await pg.get_by_role('button', name='Faltou').click()
        await expect(pg.get_by_text(re.compile('já foi paga'))).to_be_visible()
        check(True, 'Sessão paga não muda de situação sem desfazer o pagamento')
        await pg.screenshot(path='e2e_02_sessao.png', full_page=True)
        await pg.get_by_role('button', name='Voltar para hoje').click()

        # Sessão sem anotação e sem pagamento
        await pg.get_by_role('button', name='Abrir sessão').nth(1).click()
        await pg.locator('#anot').fill('Evolução: teste.\nProcedimentos: teste.\nEncaminhamentos: teste.')
        await pg.get_by_role('button', name='Salvar anotação').click()
        await expect(pg.get_by_text(re.compile(r'Versão 1 salva'))).to_be_visible()
        await pg.get_by_role('button', name='Marcar como pago').click()
        await expect(pg.get_by_text('Pagamento registrado.')).to_be_visible()
        check(True, 'Pagamento registrado pela sessão')
        await pg.get_by_role('button', name='Desfazer pagamento').click()
        await expect(pg.get_by_text('Pagamento desfeito.')).to_be_visible()
        check(True, 'Pagamento desfeito pela sessão')
        prev = pg.get_by_text(re.compile(r'Anotação da sessão anterior'))
        await prev.click()
        await expect(pg.locator('details .readonly-note')).to_contain_text('Evolução')
        check(True, 'Anotação da sessão anterior abre dentro da sessão atual')

        # Pacientes
        await pg.get_by_role('button', name='Pacientes', exact=True).click()
        await pg.get_by_role('button', name='Novo paciente').click()
        await pg.get_by_label('Nome').fill('Paciente Teste')
        await pg.get_by_label('Valor da sessão (R$)').fill('170')
        await pg.get_by_role('button', name='Salvar').click()
        await expect(pg.get_by_role('heading', name='Paciente Teste')).to_be_visible()
        check(True, 'Novo paciente cadastrado e ficha aberta')
        await pg.get_by_role('button', name='Agendar sessão').click()
        await pg.get_by_role('button', name='Agendar', exact=True).click()
        await expect(pg.locator('.row', has_text=re.compile(r'\d\d/\d\d'))).to_have_count(1)
        check(True, 'Sessão agendada aparece no histórico do paciente')
        await pg.get_by_role('button', name='Arquivar').click()
        await expect(pg.get_by_text('Paciente arquivado')).to_be_visible()
        check(True, 'Paciente arquivado (sem apagar)')
        await pg.screenshot(path='e2e_03_ficha.png', full_page=True)

        # Financeiro
        await pg.get_by_role('button', name='Financeiro', exact=True).click()
        await expect(pg.get_by_role('heading', name='Financeiro')).to_be_visible()
        before = await pg.locator('.tile.hero strong').inner_text()
        await pg.get_by_role('button', name='Marcar pago').first.click()
        await expect(pg.locator('.tile.hero strong')).not_to_have_text(before)
        check(True, 'Marcar pago no financeiro atualiza o recebido')
        async with pg.expect_download() as dl:
            await pg.get_by_role('button', name='Baixar planilha do mês').click()
        d = await dl.value
        content = open(await d.path(), encoding='utf-8-sig').read()
        check('Paciente' in content and 'Evolução' not in content, 'Planilha do financeiro não contém texto do prontuário')
        await pg.screenshot(path='e2e_04_fin.png', full_page=True)

        # Segurança
        await pg.get_by_role('button', name='Segurança', exact=True).click()
        await expect(pg.get_by_text(re.compile('Abriu anotação do prontuário')).first).to_be_visible()
        check(True, 'Histórico de acesso mostra as aberturas do prontuário')
        await pg.get_by_label('Senha atual').fill('senha-errada-qualquer-1')
        await pg.get_by_label('Nova senha').fill(NEW)
        await pg.get_by_role('button', name='Trocar senha').click()
        await expect(pg.get_by_text('Senha atual incorreta.')).to_be_visible()
        await pg.get_by_label('Senha atual').fill(PASS)
        await pg.get_by_role('button', name='Trocar senha').click()
        await expect(pg.get_by_text(re.compile('Senha do cofre trocada'))).to_be_visible()
        check(True, 'Troca da senha do cofre')
        await pg.screenshot(path='e2e_05_seg.png', full_page=True)

        # Sair e voltar
        await pg.get_by_role('button', name='Sair').click()
        await pg.get_by_role('button', name='Entrar').click()
        await pg.get_by_label('Código').fill('123456')
        await pg.get_by_role('button', name='Confirmar').click()
        await pg.get_by_label('Senha do cofre').fill(PASS)
        await pg.get_by_role('button', name='Desbloquear').click()
        await expect(pg.get_by_text('Senha do cofre incorreta.')).to_be_visible()
        check(True, 'Senha antiga do cofre não abre mais')
        await pg.get_by_role('button', name='Esqueci a senha do cofre').click()
        await pg.get_by_label('Chave de recuperação').fill(rk.lower().replace('-', ' '))
        await pg.get_by_label('Nova senha do cofre').fill('mais-uma-frase-longa-de-teste-4')
        await pg.get_by_role('button', name='Recuperar e entrar').click()
        await expect(pg.get_by_text('Marina Alves').first).to_be_visible()
        check(True, 'Chave de recuperação recupera o acesso e os dados continuam legíveis')

        # Aviso e saída por inatividade (relógio simulado)
        await pg.evaluate("""() => { const real = Date.now; window.__t0 = real(); Date.now = () => window.__t0 + 9.5*60*1000; document.dispatchEvent(new Event('visibilitychange')); }""")
        await expect(pg.get_by_role('button', name='Continuar conectada')).to_be_visible()
        check(True, 'Aviso um minuto antes da saída automática')
        await pg.evaluate("""() => { Date.now = () => window.__t0 + 11*60*1000; document.dispatchEvent(new Event('visibilitychange')); }""")
        await expect(pg.get_by_text(re.compile('saiu automaticamente'))).to_be_visible()
        check(True, 'Saída automática por inatividade')

        # Telefone
        m = await b.new_page(viewport={'width': 390, 'height': 844})
        await m.goto(BASE)
        await m.get_by_role('button', name='Entrar').click()
        sw = await m.evaluate('document.documentElement.scrollWidth')
        check(sw <= 390, 'Tela de entrada cabe no celular')
        await m.screenshot(path='e2e_06_mobile.png', full_page=True)

        check(not csp, 'Nenhuma violação da política de segurança de conteúdo: ' + '; '.join(csp[:2]))
        real_errors = [e for e in errors if 'favicon' not in e and '/fonts/' not in e and '404' not in e]
        check(not real_errors, 'Nenhum erro no console: ' + '; '.join(real_errors[:3]))
        await b.close()
    print(f'\n{len(ok)} verificações de tela passaram.')

asyncio.run(main())
