document.addEventListener('DOMContentLoaded', () => {

    // View & Modals Access
    const registerView = document.getElementById('register-view');
    const loginView = document.getElementById('login-view');
    const dashboardView = document.getElementById('dashboard-view');

    const registerForm = document.getElementById('register-form');
    const loginForm = document.getElementById('login-form');

    // =========================================
    // SEGURANÇA: Rate Limiting + Session Timeout
    // =========================================
    const MAX_LOGIN_ATTEMPTS = 5;
    const LOCKOUT_TIME_MS = 30 * 1000; // 30 segundos
    const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos
    let loginAttempts = parseInt(sessionStorage.getItem('login_attempts') || '0');
    let lockoutUntil = parseInt(sessionStorage.getItem('lockout_until') || '0');
    let sessionTimer = null;
    let isLoggedIn = false;

    // Hash simples para não guardar senha em texto puro
    const hashString = async (str) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    };

    const resetSessionTimer = () => {
        if (!isLoggedIn) return;
        clearTimeout(sessionTimer);
        sessionTimer = setTimeout(() => {
            alert('Sua sessão expirou por inatividade. Faça login novamente.');
            isLoggedIn = false;
            location.reload();
        }, SESSION_TIMEOUT_MS);
    };

    ['click', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, resetSessionTimer, { passive: true });
    });

    // --- Mobile Sidebar Overlay ---
    const sidebar = document.querySelector('.sidebar');
    const btnMobileMenu = document.getElementById('btn-mobile-menu');
    let sidebarOverlay = document.createElement('div');
    sidebarOverlay.className = 'sidebar-overlay';
    document.body.appendChild(sidebarOverlay);

    const openSidebar = () => {
        sidebar.classList.add('open');
        sidebarOverlay.classList.add('active');
    };

    const closeSidebar = () => {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('active');
    };

    if (btnMobileMenu) {
        btnMobileMenu.addEventListener('click', openSidebar);
    }
    sidebarOverlay.addEventListener('click', closeSidebar);

    // Fechar ao clicar em um link
    const navItems = document.querySelectorAll('.nav-item[data-target]');
    const contentSections = document.querySelectorAll('.content-section');

    // Settings Modal
    const settingsModal = document.getElementById('settings-modal');
    const settingsForm = document.getElementById('settings-form');

    // Motor Analítico
    const categoryAuditContainer = document.getElementById('category-audit-container');

    let transactions = [];
    let loans = [];
    let availableCapital = 0;
    let goals = []; // Goals state

    let userProfile = null; // now null initially to force signup
    let currentCategoryFilter = null;

    let categoryChartInst = null;
    let projectionChartInst = null;
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', sans-serif";

    // --- Persistência (Local Storage) ---
    const loadState = () => {
        const storedTx = localStorage.getItem('auditai_txs');
        const storedProfile = localStorage.getItem('auditai_profile');
        const storedLoans = localStorage.getItem('auditai_loans');
        const storedCapital = localStorage.getItem('auditai_available_capital');
        const storedGoals = localStorage.getItem('auditai_goals');

        if (storedTx) transactions = JSON.parse(storedTx);
        if (storedProfile) {
            userProfile = JSON.parse(storedProfile);
        }
        if (storedLoans) loans = JSON.parse(storedLoans);
        if (storedCapital) availableCapital = parseFloat(storedCapital);
        if (storedGoals) goals = JSON.parse(storedGoals);
    };

    const saveState = () => {
        localStorage.setItem('auditai_txs', JSON.stringify(transactions));
        localStorage.setItem('auditai_profile', JSON.stringify(userProfile));
        localStorage.setItem('auditai_loans', JSON.stringify(loans));
        localStorage.setItem('auditai_available_capital', availableCapital.toString());
        localStorage.setItem('auditai_goals', JSON.stringify(goals));
    };

    // Formatação Universal
    const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    const formatDate = (dateStr) => { const p = dateStr.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : dateStr; };

    // --- Boot & Fluxo de Autenticação Dupla ---
    loadState();

    if (userProfile && userProfile.email) {
        // Usuário tem conta, mostra o login
        loginView.classList.remove('hidden');
    } else {
        // Novo Usuário, mostra o Cadastro
        registerView.classList.remove('hidden');
    }

    // Toggle para links (Já tenho conta / Quero criar conta)
    document.getElementById('link-to-login').addEventListener('click', (e) => {
        e.preventDefault();
        registerView.classList.add('hidden');
        loginView.classList.remove('hidden');
    });

    document.getElementById('link-to-register').addEventListener('click', (e) => {
        e.preventDefault();
        loginView.classList.add('hidden');
        registerView.classList.remove('hidden');
    });

    // Cadastro Submit
    registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const btnReg = document.getElementById('btn-register');
        btnReg.innerHTML = '<i class="ph ph-spinner ph-spin"></i><span> Criando...</span>';

        const name = document.getElementById('reg-name').value;
        const email = document.getElementById('reg-email').value;
        const pass = document.getElementById('reg-password').value;

        setTimeout(async () => {
            const hashedPass = await hashString(pass);
            userProfile = { name, email, pass: hashedPass, avatarDataURI: null };
            saveState();

            // Vai direto pro dashboard
            isLoggedIn = true;
            resetSessionTimer();
            registerView.classList.add('hidden');
            registerView.classList.remove('active');
            dashboardView.classList.remove('hidden');
            dashboardView.classList.add('active');

            refreshProfileUI();
            updateDashboard();
        }, 1000);
    });

    // Login Submit Validação com Rate Limiting
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btnLog = document.getElementById('btn-login');
        const emailInput = document.getElementById('email').value;
        const passInput = document.getElementById('password').value;
        const errorMsg = document.getElementById('login-error-msg');

        // Verificar lockout
        const now = Date.now();
        if (lockoutUntil > now) {
            const secsLeft = Math.ceil((lockoutUntil - now) / 1000);
            errorMsg.innerText = `Muitas tentativas. Aguarde ${secsLeft}s para tentar novamente.`;
            return;
        }

        errorMsg.innerText = '';
        btnLog.innerHTML = '<i class="ph ph-spinner ph-spin"></i><span> Autenticando...</span>';

        const hashedInput = await hashString(passInput);

        setTimeout(() => {
            btnLog.innerHTML = '<span>Acessar Painel</span><i class="ph ph-sign-in"></i>';
            if (userProfile && emailInput === userProfile.email && hashedInput === userProfile.pass) {
                // Login OK
                loginAttempts = 0;
                sessionStorage.setItem('login_attempts', '0');
                sessionStorage.removeItem('lockout_until');

                isLoggedIn = true;
                resetSessionTimer();

                loginView.classList.add('hidden');
                loginView.classList.remove('active');
                dashboardView.classList.remove('hidden');
                dashboardView.classList.add('active');

                refreshProfileUI();
                updateDashboard();
            } else {
                loginAttempts++;
                sessionStorage.setItem('login_attempts', loginAttempts);

                if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
                    lockoutUntil = Date.now() + LOCKOUT_TIME_MS;
                    sessionStorage.setItem('lockout_until', lockoutUntil);
                    loginAttempts = 0;
                    sessionStorage.setItem('login_attempts', '0');
                    errorMsg.innerText = `Acesso bloqueado por 30 segundos. (${MAX_LOGIN_ATTEMPTS} tentativas inválidas)`;
                } else {
                    errorMsg.innerText = `Credenciais incorretas. Tentativa ${loginAttempts}/${MAX_LOGIN_ATTEMPTS}.`;
                }
            }
        }, 800);
    });

    // Navegação Sidebar Dinâmica

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active style from all
            navItems.forEach(nav => nav.classList.remove('active'));
            // Hide all content sections
            contentSections.forEach(content => {
                content.classList.add('hidden');
                content.classList.remove('active');
            });

            // Activate the clicked item
            item.classList.add('active');

            // Show target content
            const targetId = item.getAttribute('data-target');
            const targetContent = document.getElementById(targetId);

            if (targetContent) {
                targetContent.classList.remove('hidden');
                targetContent.classList.add('active');

                // Triggers específicos por aba
                if (targetId === 'loans-content') {
                    renderLoansDashboard();
                } else if (targetId === 'finances-content' || targetId === 'transacoes-content' || targetId === 'categorias-content') {
                    updateDashboard();
                } else if (targetId === 'relatorios-content') {
                    renderCharts();
                } else if (targetId === 'configuracoes-content') {
                    if (userProfile) {
                        document.getElementById('user-name').value = userProfile.name;
                        document.getElementById('user-email').value = userProfile.email;
                        if (userProfile.avatarDataURI) {
                            document.getElementById('avatar-preview').innerHTML = `<img src="${userProfile.avatarDataURI}" />`;
                        }
                    }
                }

                // Fechar sidebar no mobile após clique
                if (window.innerWidth <= 900) {
                    closeSidebar();
                }
            }
        });
    });

    document.getElementById('btn-logout').addEventListener('click', () => location.reload());

    // --- Modal de Transações (CRUD) ---
    const typeEx = document.getElementById('type-expense');
    const payMet = document.getElementById('payment-method');

    const updateFormViz = () => {
        document.getElementById('expense-type-group').style.display = typeEx.checked ? 'block' : 'none';
        document.getElementById('installments-group').style.display = payMet.value === 'Crédito' ? 'block' : 'none';
    };

    typeEx.addEventListener('change', updateFormViz);
    document.getElementById('type-income').addEventListener('change', updateFormViz);
    payMet.addEventListener('change', updateFormViz);

    const openTxModal = (editItem = null) => {
        transactionModal.classList.remove('hidden');
        if (editItem) {
            modalTitle.innerText = "Editar Transação ANOTAÍ";
            inputEditId.value = editItem.id;
            document.getElementById(editItem.type === 'income' ? 'type-income' : 'type-expense').checked = true;

            if (editItem.status === 'pending') {
                document.getElementById('status-pending').checked = true;
            } else {
                document.getElementById('status-paid').checked = true;
            }

            document.getElementById('desc').value = editItem.description;
            document.getElementById('category').value = editItem.category;
            if (editItem.type === 'expense') document.getElementById('expense-type').value = editItem.expenseType;
            document.getElementById('payment-method').value = editItem.paymentMethod;
            document.getElementById('amount').value = editItem.amount;
            document.getElementById('date').value = editItem.date;
            document.getElementById('installments').value = "1";
        } else {
            modalTitle.innerText = "Adicionar Transação";
            inputEditId.value = "";
            transactionForm.reset();
            document.getElementById('date').valueAsDate = new Date();
            document.getElementById('type-income').checked = true;
            document.getElementById('status-paid').checked = true;
        }
        updateFormViz();
    };

    const closeTxModal = () => { transactionModal.classList.add('hidden'); transactionForm.reset(); };
    document.querySelectorAll('.btn-new-transaction').forEach(btn => btn.addEventListener('click', () => openTxModal()));
    document.getElementById('btn-close-modal').addEventListener('click', closeTxModal);
    document.getElementById('btn-cancel-modal').addEventListener('click', closeTxModal);

    // Salvar Transação
    transactionForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = inputEditId.value;
        const type = document.querySelector('input[name="type"]:checked').value;
        const status = document.querySelector('input[name="tx-status"]:checked').value;
        const desc = document.getElementById('desc').value;
        const cat = document.getElementById('category').value;
        const eType = document.getElementById('expense-type').value;
        const pm = document.getElementById('payment-method').value;
        const amt = parseFloat(document.getElementById('amount').value);
        const dat = document.getElementById('date').value;
        const inst = parseInt(document.getElementById('installments').value) || 1;

        if (id) {
            const idx = transactions.findIndex(t => t.id == id);
            if (idx > -1) {
                transactions[idx] = { ...transactions[idx], type, status, description: desc, category: cat, expenseType: type === 'expense' ? eType : null, paymentMethod: pm, amount: amt, date: dat };
            }
        } else {
            const [y, m, d] = dat.split('-');
            const baseD = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));

            if (pm === 'Crédito' && inst > 1 && type === 'expense') {
                const portion = amt / inst;
                for (let i = 0; i < inst; i++) {
                    const instDat = new Date(baseD.getFullYear(), baseD.getMonth() + i, baseD.getDate());
                    transactions.push({ id: Date.now() + i, type, status, description: `${desc} (${i + 1}/${inst})`, category: cat, expenseType: eType, paymentMethod: pm, amount: portion, date: instDat.toISOString().split('T')[0] });
                }
            } else {
                transactions.push({ id: Date.now(), type, status, description: desc, category: cat, expenseType: type === 'expense' ? eType : null, paymentMethod: pm, amount: amt, date: dat });
            }
        }
        saveAndRender();
        closeTxModal();
    });

    window.deleteTx = (id) => {
        if (confirm("Deseja realmente excluir esta transação do registro ANOTAÍ?")) {
            transactions = transactions.filter(t => t.id != id);
            saveAndRender();
        }
    };
    window.editTx = (id) => {
        const item = transactions.find(t => t.id == id);
        if (item) openTxModal(item);
    };

    // --- Lógica de View (Dashboard Integrado) ---
    const saveAndRender = () => { saveState(); updateDashboard(); };

    const updateDashboard = () => {
        const tInc = transactions.filter(t => t.type === 'income').reduce((a, c) => a + c.amount, 0);
        const tExp = transactions.filter(t => t.type === 'expense').reduce((a, c) => a + c.amount, 0);
        document.getElementById('total-income').textContent = formatCurrency(tInc);
        document.getElementById('total-expense').textContent = formatCurrency(tExp);
        document.getElementById('total-balance').textContent = formatCurrency(tInc - tExp);

        renderList();
        renderAuditPanel();
        renderCharts();

        renderMetas();
        renderAgenda();
        renderScheduled();
        renderLoansDashboard();
    };

    // --- Lógica de Agendadas, Agenda e Metas ---
    const renderAgenda = () => {
        const el = document.getElementById('agenda-list');
        if (!el) return;
        el.innerHTML = '';
        if (!transactions.length) {
            el.innerHTML = '<div class="empty-state"><i class="ph ph-calendar"></i><p>Nenhuma movimentação para exibir na agenda.</p></div>';
            return;
        }

        [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(t => {
            const isInc = t.type === 'income';
            const isPending = t.status === 'pending';
            const div = document.createElement('div');
            div.className = 'transaction-item';
            div.innerHTML = `
                <div class="item-left">
                    <div class="item-icon ${isInc ? 'income' : 'expense'}" style="${isPending ? 'opacity:0.5;' : ''}">
                        <i class="ph ${isInc ? 'ph-arrow-up-right' : 'ph-arrow-down-left'}"></i>
                    </div>
                    <div class="item-details">
                        <h4>${t.description} ${isPending ? '<span style="color:#f59e0b; font-size:0.75rem;">(Agendado)</span>' : ''}</h4>
                        <div class="badges-row">
                            <span class="badge badge-neutral">${formatDate(t.date)}</span>
                            <span class="badge ${isInc ? 'badge-success' : 'badge-danger'}">${t.category}</span>
                        </div>
                    </div>
                </div>
                <div class="item-right-wrapper">
                    <div class="item-amount ${isInc ? 'income' : 'expense'}" style="${isPending ? 'opacity:0.5;' : ''}">
                        ${isInc ? '+' : '-'} ${formatCurrency(t.amount)}
                    </div>
                </div>
            `;
            el.appendChild(div);
        });
    };

    const renderScheduled = () => {
        const el = document.getElementById('scheduled-list');
        if (!el) return;
        el.innerHTML = '';

        const scheduledTxs = transactions.filter(t => t.status === 'pending');

        if (!scheduledTxs.length) {
            el.innerHTML = '<div class="empty-state"><i class="ph ph-check-circle"></i><p>Nenhuma transação agendada ou pendente.</p></div>';
            return;
        }

        window.payScheduledTx = (id) => {
            const idx = transactions.findIndex(t => t.id == id);
            if (idx > -1) {
                if (confirm(`Confirmar o pagamento efetivo de: ${transactions[idx].description}?`)) {
                    transactions[idx].status = 'paid';
                    saveAndRender();
                }
            }
        };

        [...scheduledTxs].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(t => {
            const isInc = t.type === 'income';

            // Verifica o atraso
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tDate = new Date(t.date + 'T00:00:00');
            const isOverdue = tDate < today;

            const div = document.createElement('div');
            div.className = 'transaction-item';
            if (isOverdue) div.style.borderLeft = '4px solid var(--danger)';

            div.innerHTML = `
                <div class="item-left">
                    <div class="item-icon ${isInc ? 'income' : 'expense'}" style="opacity:0.7;">
                        <i class="ph ${isOverdue ? 'ph-warning' : 'ph-clock'}"></i>
                    </div>
                    <div class="item-details">
                        <h4 style="${isOverdue ? 'color: var(--danger);' : ''}">${t.description}</h4>
                        <div class="badges-row">
                            <span class="badge badge-neutral"><i class="ph ph-calendar"></i> ${formatDate(t.date)}</span>
                            ${isOverdue ? '<span class="badge badge-danger">Atrasado</span>' : '<span class="badge badge-warning">Pendente</span>'}
                        </div>
                    </div>
                </div>
                <div class="item-right-wrapper">
                    <div class="item-amount ${isInc ? 'income' : 'expense'}">${isInc ? '+' : '-'} ${formatCurrency(t.amount)}</div>
                    <div class="item-actions">
                        <button class="action-btn edit" onclick="payScheduledTx(${t.id})" title="Marcar como Pago" style="color:var(--success);"><i class="ph ph-check-circle"></i> Efetivar</button>
                        <button class="action-btn delete" onclick="deleteTx(${t.id})" title="Apagar"><i class="ph ph-trash"></i> Cancelar</button>
                    </div>
                </div>
            `;
            el.appendChild(div);
        });
    };

    const goalModal = document.getElementById('goal-modal');
    const addGoalFundModal = document.getElementById('add-goal-fund-modal');
    const goalForm = document.getElementById('goal-form');
    const goalFundForm = document.getElementById('goal-fund-form');

    if (document.getElementById('btn-new-goal')) {
        document.getElementById('btn-new-goal').addEventListener('click', () => {
            if (goalForm) goalForm.reset();
            goalModal.classList.remove('hidden');
        });
        document.getElementById('btn-close-goal').addEventListener('click', () => goalModal.classList.add('hidden'));
        document.getElementById('btn-cancel-goal').addEventListener('click', () => goalModal.classList.add('hidden'));

        document.getElementById('btn-close-goal-fund').addEventListener('click', () => addGoalFundModal.classList.add('hidden'));
        document.getElementById('btn-cancel-goal-fund').addEventListener('click', () => addGoalFundModal.classList.add('hidden'));

        if (goalForm) {
            goalForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const name = document.getElementById('goal-name').value;
                const target = parseFloat(document.getElementById('goal-target').value);

                goals.push({ id: Date.now(), name, target, current: 0 });
                goalModal.classList.add('hidden');
                saveAndRender();
            });
        }

        if (goalFundForm) {
            goalFundForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const gId = document.getElementById('fund-goal-id').value;
                const amt = parseFloat(document.getElementById('goal-fund-amount').value);

                const g = goals.find(x => x.id == gId);
                if (g) {
                    g.current += amt;
                    saveAndRender();
                }
                addGoalFundModal.classList.add('hidden');
            });
        }
    }

    const renderMetas = () => {
        const el = document.getElementById('goals-list');
        if (!el) return;

        let txtTotalSaved = 0;
        let txtTotalTarget = 0;

        el.innerHTML = '';
        if (!goals.length) {
            el.innerHTML = '<div class="empty-state"><i class="ph ph-target"></i><p>Você ainda não definiu nenhuma meta.</p></div>';
        } else {
            goals.forEach(g => {
                txtTotalSaved += g.current;
                txtTotalTarget += g.target;

                const pct = Math.min((g.current / g.target) * 100, 100).toFixed(1);

                const div = document.createElement('div');
                div.className = 'transaction-item';
                div.style.flexDirection = 'column';
                div.style.alignItems = 'stretch';
                div.style.gap = '12px';

                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div class="item-left">
                            <div class="item-icon expense" style="background: rgba(16, 185, 129, 0.1); color: var(--success);"><i class="ph ph-target"></i></div>
                            <div class="item-details">
                                <h4>${g.name}</h4>
                                <span>Progresso: ${pct}%</span>
                            </div>
                        </div>
                        <div class="item-right-wrapper">
                            <div class="item-amount" style="color:var(--text-color); font-size:1rem;">
                                ${formatCurrency(g.current)} <span style="font-size:0.8rem; color:var(--text-muted); font-weight:normal;">/ ${formatCurrency(g.target)}</span>
                            </div>
                            <div class="item-actions">
                                <button class="action-btn edit" onclick="openFundGoal(${g.id})" title="Guardar Dinheiro"><i class="ph ph-plus-circle"></i> Guardar</button>
                                <button class="action-btn delete" onclick="deleteGoal(${g.id})" title="Excluir Meta"><i class="ph ph-trash"></i> Excluir</button>
                            </div>
                        </div>
                    </div>
                    <div style="width:100%; height:8px; background: rgba(255,255,255,0.05); border-radius:4px; overflow:hidden;">
                        <div style="height:100%; width:${pct}%; background:var(--success); border-radius:4px;"></div>
                    </div>
                `;
                el.appendChild(div);
            });
        }

        window.openFundGoal = (id) => {
            document.getElementById('fund-goal-id').value = id;
            document.getElementById('goal-fund-amount').value = '';
            addGoalFundModal.classList.remove('hidden');
        };
        window.deleteGoal = (id) => {
            if (confirm('Tem certeza que deseja excluir esta meta? O valor guardado não afetará seu saldo geral, apenas a meta será removida.')) {
                goals = goals.filter(g => g.id != id);
                saveAndRender();
            }
        };

        const totalSavedEl = document.getElementById('goals-total-saved');
        const totalTargetEl = document.getElementById('goals-total-target');
        if (totalSavedEl) totalSavedEl.textContent = formatCurrency(txtTotalSaved);
        if (totalTargetEl) totalTargetEl.textContent = formatCurrency(txtTotalTarget);
    };

    // Painel Analítico: Cálculo Real de Despesas por Categoria
    const renderAuditPanel = () => {
        const expenses = transactions.filter(t => t.type === 'expense' && t.status !== 'pending'); // Apenas os pagos para o cálculo das categorias reais
        const containers = [
            document.getElementById('category-audit-container'),
            document.getElementById('dashboard-category-audit')
        ].filter(Boolean);

        if (expenses.length === 0) {
            containers.forEach(c => c.innerHTML = '<div class="empty-state-slim">Você precisa adicionar despesas para visualizar esta análise matemática.</div>');
            return;
        }

        // Reduce somando valor por cada Categoria
        const catSums = expenses.reduce((acc, obj) => {
            acc[obj.category] = (acc[obj.category] || 0) + obj.amount;
            return acc;
        }, {});

        // Dicionário de mini-ícones por string de categoria para ficar legal
        const catIcons = {
            'Alimentação': 'ph-hamburger',
            'Transporte': 'ph-car-profile',
            'Saúde': 'ph-heartbeat',
            'Beleza': 'ph-scissors',
            'Lazer': 'ph-game-controller',
            'Moradia': 'ph-house',
            'Serviços': 'ph-lightning',
            'Outros': 'ph-dots-three-circle'
        };

        const sortedCats = Object.keys(catSums).sort((a, b) => catSums[b] - catSums[a]);

        containers.forEach(container => {
            container.innerHTML = '';
            sortedCats.forEach(cat => {
                const val = formatCurrency(catSums[cat]);
                const icon = catIcons[cat] || 'ph-tag';

                const pill = document.createElement('div');
                pill.className = 'audit-pill' + (currentCategoryFilter === cat ? ' active' : '');
                pill.onclick = () => {
                    currentCategoryFilter = currentCategoryFilter === cat ? null : cat;
                    renderAuditPanel();
                    renderList();
                };
                pill.innerHTML = `
                    <span><i class="ph ${icon}"></i> Custo de ${cat}</span>
                    <h4>${val}</h4>
                `;
                container.appendChild(pill);
            });
        });
    };

    const renderList = () => {
        const els = [
            document.getElementById('transactions-list'),
            document.getElementById('dashboard-transactions-list')
        ].filter(Boolean);

        els.forEach(el => el.innerHTML = '');

        let filteredTxs = transactions;
        if (currentCategoryFilter) {
            filteredTxs = transactions.filter(t => t.category === currentCategoryFilter);
        }

        if (!filteredTxs.length) {
            els.forEach(el => el.innerHTML = '<div class="empty-state"><i class="ph ph-receipt"></i><p>Nenhuma movimentação para exibir.</p></div>');
            return;
        }

        [...filteredTxs].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(t => {
            const isInc = t.type === 'income';

            const isPending = t.status === 'pending';

            const itemHTML = `
                <div class="item-left">
                    <div class="item-icon ${isInc ? 'income' : 'expense'}" style="${isPending ? 'opacity:0.5;' : ''}"><i class="ph ${isInc ? 'ph-arrow-up-right' : 'ph-arrow-down-left'}"></i></div>
                    <div class="item-details">
                        <h4>${t.description} ${isPending ? '<span style="color:#f59e0b; font-size:0.75rem;">(Agendado)</span>' : ''}</h4>
                        <div class="badges-row">
                            <span class="badge ${isInc ? 'badge-success' : 'badge-danger'}">${t.category}</span>
                            ${(t.paymentMethod !== 'Dinheiro' && t.paymentMethod !== 'Pix') ? `<span class="badge badge-neutral">${t.paymentMethod}</span>` : ''}
                            ${t.type === 'expense' ? `<span class="badge badge-neutral">${t.expenseType}</span>` : ''}
                        </div>
                        <span>${formatDate(t.date)}</span>
                    </div>
                </div>
                <div class="item-right-wrapper">
                    <div class="item-amount ${isInc ? 'income' : 'expense'}" style="${isPending ? 'opacity:0.5;' : ''}">${isInc ? '+' : '-'} ${formatCurrency(t.amount)}</div>
                    <div class="item-actions">
                        <button class="action-btn edit" onclick="editTx(${t.id})" title="Editar"><i class="ph ph-pencil-simple"></i> Editar</button>
                        <button class="action-btn delete" onclick="deleteTx(${t.id})" title="Apagar"><i class="ph ph-trash"></i> Excluir</button>
                    </div>
                </div>
            `;

            els.forEach(el => {
                const div = document.createElement('div');
                div.className = 'transaction-item';
                div.innerHTML = itemHTML;
                el.appendChild(div);
            });
        });
    };

    const renderCharts = () => {
        const ctxCat = document.getElementById('categoryChart')?.getContext('2d');
        const ctxProj = document.getElementById('projectionChart')?.getContext('2d');
        if (!ctxCat || !ctxProj) return;

        if (!categoryChartInst) categoryChartInst = new Chart(ctxCat, { type: 'doughnut', data: { labels: [], datasets: [] }, options: { responsive: true, maintainAspectRatio: false } });
        if (!projectionChartInst) projectionChartInst = new Chart(ctxProj, { type: 'bar', data: { labels: [], datasets: [] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { callback: v => 'R$ ' + v } } } } });

        const periodSelect = document.getElementById('report-period');
        const periodDays = periodSelect ? periodSelect.value : '30';

        let filteredTransactions = [...transactions];
        if (periodDays !== 'all') {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - parseInt(periodDays));
            filteredTransactions = transactions.filter(t => new Date(t.date + 'T00:00:00') >= cutoffDate);
        }

        const expenses = filteredTransactions.filter(t => t.type === 'expense');
        const catMap = {}; expenses.forEach(t => catMap[t.category] = (catMap[t.category] || 0) + t.amount);
        categoryChartInst.data.labels = Object.keys(catMap);
        categoryChartInst.data.datasets = [{ data: Object.values(catMap), backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#06b6d4', '#8b5cf6', '#ec4899', '#6366f1'], borderWidth: 0 }];
        categoryChartInst.update();

        const projMap = {};
        const now = new Date();
        for (let i = 0; i < 6; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); projMap[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = { inc: 0, expFix: 0, expVar: 0 }; }
        filteredTransactions.forEach(t => {
            const kl = `${t.date.split('-')[0]}-${t.date.split('-')[1]}`;
            if (projMap[kl]) { if (t.type === 'income') projMap[kl].inc += t.amount; else if (t.expenseType === 'Fixo') projMap[kl].expFix += t.amount; else projMap[kl].expVar += t.amount; }
        });

        const lbs = Object.keys(projMap).sort();
        projectionChartInst.data.labels = lbs.map(l => `${l.split('-')[1]}/${l.split('-')[0]}`);
        projectionChartInst.data.datasets = [
            { label: 'Receitas', backgroundColor: '#10b981', data: lbs.map(l => projMap[l].inc) },
            { label: 'Desp. Fixas', backgroundColor: '#ef4444', data: lbs.map(l => projMap[l].expFix) },
            { label: 'Desp. Variáveis', backgroundColor: '#f97316', data: lbs.map(l => projMap[l].expVar) }
        ];
        projectionChartInst.update();
    };

    // Filtro de Período nos Relatórios (Listener)
    const reportPeriodEl = document.getElementById('report-period');
    if (reportPeriodEl) {
        reportPeriodEl.addEventListener('change', () => renderCharts());
    }

    // --- Configurações de Perfil ---
    document.getElementById('btn-settings').addEventListener('click', () => {
        const configBtn = document.querySelector('.nav-item[data-target="configuracoes-content"]');
        if (configBtn) configBtn.click();
    });

    document.getElementById('avatar-input').addEventListener('change', function () {
        if (this.files && this.files[0]) {
            const reader = new FileReader();
            reader.onload = function (e) {
                userProfile.avatarDataURI = e.target.result;
                document.getElementById('avatar-preview').innerHTML = `<img src="${e.target.result}" />`;
            }
            reader.readAsDataURL(this.files[0]);
        }
    });

    const settingsFormEl = document.getElementById('settings-form');
    if (settingsFormEl) {
        settingsFormEl.addEventListener('submit', (e) => {
            e.preventDefault();
            userProfile.name = document.getElementById('user-name').value;
            userProfile.email = document.getElementById('user-email').value;
            const nPass = document.getElementById('user-password').value;
            if (nPass) userProfile.pass = nPass;

            saveState();
            refreshProfileUI();

            const submitBtn = settingsFormEl.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerText;
            submitBtn.innerText = "Atualizado com sucesso!";
            submitBtn.style.backgroundColor = 'var(--success)';
            submitBtn.style.color = '#fff';
            setTimeout(() => {
                submitBtn.innerText = originalText;
                submitBtn.style.backgroundColor = '';
                submitBtn.style.color = '';
            }, 2000);
        });
    }

    const refreshProfileUI = () => {
        if (!userProfile) return;
        document.getElementById('display-user-name').textContent = userProfile.name;
        const navAv = document.getElementById('nav-avatar');
        if (userProfile.avatarDataURI) navAv.innerHTML = `<img src="${userProfile.avatarDataURI}" />`;
        else navAv.innerHTML = `<i class="ph ph-user"></i>`;
    };

    // =========================================
    // LÓGICA DE EMPRÉSTIMOS
    // =========================================
    const loansTotalCapitalEl = document.getElementById('loans-total-capital');
    const loansLentCapitalEl = document.getElementById('loans-lent-capital');
    const loansAvailableCapitalEl = document.getElementById('loans-available-capital');

    const loansOverdueListEl = document.getElementById('loans-overdue-list');
    const overdueLoansTitleEl = document.getElementById('overdue-loans-title');
    const loansListEl = document.getElementById('loans-list');
    const loansPaidListEl = document.getElementById('loans-paid-list');

    // Modais
    const capitalModal = document.getElementById('capital-modal');
    const capitalForm = document.getElementById('capital-form');
    const loanModal = document.getElementById('loan-modal');
    const loanForm = document.getElementById('loan-form');

    const openCapitalModal = () => { capitalForm.reset(); capitalModal.classList.remove('hidden'); };
    const closeCapitalModal = () => capitalModal.classList.add('hidden');
    const openLoanModal = () => { loanForm.reset(); document.getElementById('loan-date').valueAsDate = new Date(); loanModal.classList.remove('hidden'); };
    const closeLoanModal = () => loanModal.classList.add('hidden');

    if (document.getElementById('btn-add-capital')) document.getElementById('btn-add-capital').addEventListener('click', openCapitalModal);
    if (document.getElementById('btn-close-capital')) document.getElementById('btn-close-capital').addEventListener('click', closeCapitalModal);
    if (document.getElementById('btn-cancel-capital')) document.getElementById('btn-cancel-capital').addEventListener('click', closeCapitalModal);

    if (document.getElementById('btn-new-loan')) document.getElementById('btn-new-loan').addEventListener('click', openLoanModal);
    if (document.getElementById('btn-close-loan')) document.getElementById('btn-close-loan').addEventListener('click', closeLoanModal);
    if (document.getElementById('btn-cancel-loan')) document.getElementById('btn-cancel-loan').addEventListener('click', closeLoanModal);

    const renderLoansDashboard = () => {
        let lentCapital = 0;
        let activeLoansHTML = '';
        let overdueLoansHTML = '';
        let paidLoansHTML = '';

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        loans.forEach(loan => {
            const isPaid = loan.status === 'paid';
            const interestAmt = loan.amount * (loan.rate / 100);

            if (!isPaid) lentCapital += loan.amount;

            // Converter data do loan para Date para comparar vencimento
            const loanDate = new Date(loan.date + 'T00:00:00');
            const isOverdue = !isPaid && loanDate < today;

            // Cores: Verde (Pago), Vermelho (Vencido), Amarelo (Ativo no prazo)
            let borderColor = '#f59e0b';
            let iconColorClass = 'expense';
            let iconBgColor = 'rgba(245, 158, 11, 0.1)';
            let iconColor = '#f59e0b';
            let statusText = 'No Prazo';
            let iconClass = 'ph-clock';

            if (isPaid) {
                borderColor = '#10b981';
                iconColorClass = 'income';
                iconBgColor = 'rgba(16, 185, 129, 0.1)';
                iconColor = 'var(--success)';
                statusText = 'Quitado';
                iconClass = 'ph-check-circle';
            } else if (isOverdue) {
                borderColor = '#ef4444';
                iconBgColor = 'rgba(239, 68, 68, 0.1)';
                iconColor = 'var(--danger)';
                statusText = 'VENCIDO';
                iconClass = 'ph-warning-circle';
            }

            const html = `
                <div class="transaction-item" style="border-left: 4px solid ${borderColor};">
                    <div class="item-left">
                        <div class="item-icon ${iconColorClass}" style="background: ${iconBgColor}; color: ${iconColor};">
                            <i class="ph ${iconClass}"></i>
                        </div>
                        <div class="item-details">
                            <h4 style="${isOverdue ? 'color: var(--danger);' : ''}">${loan.name}</h4>
                            <div class="loan-info">
                                <span>Valor Emprestado: <strong>${formatCurrency(loan.amount)}</strong></span>
                                <span>Taxa: <strong>${loan.rate}%</strong> <span class="loan-interest">(Juros esperado: ${formatCurrency(interestAmt)})</span></span>
                                <span style="${isOverdue ? 'color: var(--danger); font-weight: bold;' : ''}">Vencimento: <strong>${formatDate(loan.date)}</strong></span>
                            </div>
                        </div>
                    </div>
                    <div class="item-right-wrapper">
                        <div class="item-amount" style="color: ${iconColor};">${statusText}</div>
                        ${!isPaid ? `
                        <div class="item-actions">
                            <button class="action-btn edit" onclick="payLoanInterest(${loan.id})" title="Pagar somente Juros"><i class="ph ph-coins"></i> Só Juros</button>
                            <button class="action-btn delete" onclick="payLoanFull(${loan.id})" title="Quitar Empréstimo Total" style="color:var(--success);"><i class="ph ph-check-square-offset"></i> Quitar</button>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;

            if (isPaid) {
                paidLoansHTML += html;
            } else if (isOverdue) {
                overdueLoansHTML += html;
            } else {
                activeLoansHTML += html;
            }
        });

        const totalCapital = availableCapital + lentCapital;

        if (loansTotalCapitalEl) loansTotalCapitalEl.textContent = formatCurrency(totalCapital);
        if (loansAvailableCapitalEl) loansAvailableCapitalEl.textContent = formatCurrency(availableCapital);
        if (loansLentCapitalEl) loansLentCapitalEl.textContent = formatCurrency(lentCapital);

        // Renderizar ou esconder Vencidos
        if (overdueLoansHTML) {
            if (overdueLoansTitleEl) overdueLoansTitleEl.style.display = 'flex';
            if (loansOverdueListEl) {
                loansOverdueListEl.style.display = 'block';
                loansOverdueListEl.innerHTML = overdueLoansHTML;
            }
        } else {
            if (overdueLoansTitleEl) overdueLoansTitleEl.style.display = 'none';
            if (loansOverdueListEl) {
                loansOverdueListEl.style.display = 'none';
                loansOverdueListEl.innerHTML = '';
            }
        }

        if (loansListEl) {
            loansListEl.innerHTML = activeLoansHTML || '<div class="empty-state"><i class="ph ph-folder-open"></i><p>Nenhum empréstimo no prazo.</p></div>';
        }
        if (loansPaidListEl) {
            loansPaidListEl.innerHTML = paidLoansHTML || '<div class="empty-state"><i class="ph ph-check-circle"></i><p>Nenhum empréstimo quitado.</p></div>';
        }
    };

    // Form Submit: Aportar Capital
    if (capitalForm) {
        capitalForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const type = document.querySelector('input[name="cap-type"]:checked').value;
            const amt = parseFloat(document.getElementById('capital-amount').value);

            if (type === 'add') {
                availableCapital += amt;
            } else {
                if (amt > availableCapital) {
                    alert("Você não pode retirar mais do que o capital disponível atual.");
                    return;
                }
                availableCapital -= amt;
            }

            saveState();
            renderLoansDashboard();
            closeCapitalModal();
        });
    }

    // Form Submit: Novo Empréstimo
    if (loanForm) {
        loanForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('loan-name').value;
            const amount = parseFloat(document.getElementById('loan-amount').value);
            const rate = parseFloat(document.getElementById('loan-rate').value);
            const date = document.getElementById('loan-date').value;

            if (amount > availableCapital) {
                alert(`Capital Disponível Insuficiente! Você tem apenas ${formatCurrency(availableCapital)} disponível para emprestar.`);
                return;
            }

            availableCapital -= amount; // Deduct from available pool
            loans.push({
                id: Date.now(),
                name,
                amount,
                rate,
                date,
                status: 'active'
            });

            saveState();
            renderLoansDashboard();
            closeLoanModal();
        });
    }

    // Ações de Pagamento (Anexadas ao window para o onClick HTML)
    window.payLoanInterest = (id) => {
        const loan = loans.find(l => l.id == id);
        if (!loan) return;

        const interestAmt = loan.amount * (loan.rate / 100);
        if (confirm(`Confirmar recebimento de APENAS OS JUROS no valor de ${formatCurrency(interestAmt)} do cliente ${loan.name}?\n\nO capital principal continuará emprestado e a data de vencimento será prorrogada para o próximo mês.`)) {
            availableCapital += interestAmt; // Juros rola de volta para o principal disponivel

            // Incrementa 1 mês no vencimento
            const d = new Date(loan.date + 'T00:00:00'); // Evita timezone offset issues
            d.setMonth(d.getMonth() + 1);
            loan.date = d.toISOString().split('T')[0];

            saveState();
            renderLoansDashboard();
        }
    };

    window.payLoanFull = (id) => {
        const loan = loans.find(l => l.id == id);
        if (!loan) return;

        const interestAmt = loan.amount * (loan.rate / 100);
        const totalGet = loan.amount + interestAmt;

        if (confirm(`Confirmar QUITAÇÃO TOTAL de ${loan.name}?\nVocê receberá o Principal ${formatCurrency(loan.amount)} + Juros ${formatCurrency(interestAmt)} = Total de ${formatCurrency(totalGet)}`)) {
            availableCapital += totalGet;
            loan.status = 'paid';

            saveState();
            renderLoansDashboard();
        }
    };

    // Render Inicial forçado de toda a UI
    if (window.location.protocol !== 'hidden') {
        renderLoansDashboard();
        updateDashboard();
    }

});
