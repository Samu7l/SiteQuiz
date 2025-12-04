const app = {
    data: {
        manifest: null,
        currentQuiz: null,
        userAnswers: {}, 
        currentQuestionIndex: 0,
        isAnimating: false // NEW: Prevents double-clicking
    },

    init: async () => {
        try {
            const response = await fetch('quizzes/index.json');
            app.data.manifest = await response.json();
            app.renderSidebar();
        } catch (e) {
            console.error("Failed to load quiz manifest", e);
        }
    },

    // ... [Previous Navigation & Sidebar code remains exactly the same] ...
    // (Copy showView, showHome, showCustomBuilder, renderSidebar, renderSavedCustom, deleteCustomQuiz, prepareQuiz, fetchJson, generateQuestionsFromRange from previous answer)

    // --- RE-INSERT THE NAVIGATION & SIDEBAR CODE HERE IF YOU COPY-PASTE WHOLE FILE ---
    // For brevity, I am showing the CHANGED sections below:

    showView: (viewId) => {
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        document.getElementById('app-content').scrollTop = 0;
    },

    showHome: () => {
        app.showView('view-home');
        document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
    },

    showCustomBuilder: () => {
        app.renderCustomBuilder();
        app.showView('view-custom-builder');
    },

    renderSidebar: () => {
        // ... (Same as previous code) ...
        const createItem = (item, type, isDeletable = false) => {
            const div = document.createElement('div');
            div.className = 'sidebar-item';
            
            const textDiv = document.createElement('div');
            textDiv.innerHTML = `<strong>${item.title}</strong><br><small>${type}</small>`;
            textDiv.onclick = () => app.prepareQuiz(item.id, type, div);
            div.appendChild(textDiv);

            if (isDeletable) {
                const delBtn = document.createElement('button');
                delBtn.className = 'delete-btn';
                delBtn.innerHTML = '&times;';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    if(confirm("Delete this quiz?")) app.deleteCustomQuiz(item.id);
                };
                div.appendChild(delBtn);
            }
            return div;
        };
        // (Keep the rest of renderSidebar logic)
        const fill = (id, list, type) => {
            const container = document.getElementById(id);
            container.innerHTML = '';
            list.forEach(item => container.appendChild(createItem(item, type)));
        };
        fill('list-modules', app.data.manifest.modules, 'Module');
        fill('list-checkpoints', app.data.manifest.checkpoints, 'Checkpoint');
        
        const finalContainer = document.getElementById('list-final');
        finalContainer.innerHTML = '';
        if (app.data.manifest.finalExam) finalContainer.appendChild(createItem(app.data.manifest.finalExam, 'Final Exam'));
        app.renderSavedCustom();
    },

    renderSavedCustom: () => {
        // ... (Same as previous code) ...
        const container = document.getElementById('list-saved');
        const saved = JSON.parse(localStorage.getItem('customQuizzes') || '[]');
        container.innerHTML = '';
        if (saved.length === 0) {
            container.innerHTML = '<p class="empty-msg" style="padding:0.5rem; color:#888;">No saved quizzes.</p>';
            return;
        }
        saved.forEach(q => {
            const div = document.createElement('div');
            div.className = 'sidebar-item';
            div.style.borderLeft = '3px solid #9b59b6';
            div.innerHTML = `<div><strong>${q.title}</strong><br><small>${q.questions.length} Qs</small></div>`;
            div.onclick = () => app.loadInMemoryQuiz(q);
            const delBtn = document.createElement('button');
            delBtn.className = 'delete-btn';
            delBtn.innerHTML = '&times;';
            delBtn.onclick = (e) => { e.stopPropagation(); if(confirm(`Delete "${q.title}"?`)) app.deleteCustomQuiz(q.id); };
            div.appendChild(delBtn);
            container.appendChild(div);
        });
    },

    deleteCustomQuiz: (id) => {
        let saved = JSON.parse(localStorage.getItem('customQuizzes') || '[]');
        saved = saved.filter(q => q.id !== id);
        localStorage.setItem('customQuizzes', JSON.stringify(saved));
        app.renderSavedCustom();
    },

    prepareQuiz: async (id, type, domElement) => {
        document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
        if (domElement) domElement.classList.add('active');

        let quizData = null;
        let item = null;

        if (type === 'Module') {
            item = app.data.manifest.modules.find(m => m.id === id);
            quizData = await app.fetchJson(item.file);
        } else if (type === 'Checkpoint') {
            item = app.data.manifest.checkpoints.find(c => c.id === id);
            quizData = await app.fetchJson(item.file);
            if (!quizData.questions || quizData.questions.length === 0) {
                quizData = await app.generateQuestionsFromRange(quizData, item.moduleRange);
            }
        } else if (type === 'Final Exam') {
            item = app.data.manifest.finalExam;
            quizData = await app.fetchJson(item.file);
            if (!quizData.questions || quizData.questions.length === 0) {
                quizData = await app.generateQuestionsFromRange(quizData, [1, 27]);
            }
        }
        if (quizData) app.loadInMemoryQuiz(quizData);
    },

    fetchJson: async (path) => {
        const res = await fetch(`quizzes/${path}`);
        return await res.json();
    },

    generateQuestionsFromRange: async (baseQuiz, range) => {
        const [start, end] = range;
        let pool = [];
        const modulesToFetch = app.data.manifest.modules.filter(m => m.moduleNumber >= start && m.moduleNumber <= end);
        for (const m of modulesToFetch) {
            try {
                const mData = await app.fetchJson(m.file);
                if (mData.questions) pool = pool.concat(mData.questions);
            } catch(e) { console.warn(`Could not load ${m.file}`); }
        }
        pool.sort(() => 0.5 - Math.random());
        baseQuiz.questions = pool.slice(0, baseQuiz.maxQuestions || 50);
        return baseQuiz;
    },
    
    // --- END OF BOILERPLATE, HERE IS THE UPDATED QUIZ ENGINE ---

    loadInMemoryQuiz: (quizObj) => {
        app.data.currentQuiz = quizObj;
        app.data.currentQuestionIndex = 0;
        app.data.userAnswers = {};
        app.data.isAnimating = false; // Reset animation lock
        
        document.getElementById('start-title').innerText = quizObj.title;
        document.getElementById('start-pass').innerText = quizObj.passPercentage || 70;
        document.getElementById('start-qcount').innerText = quizObj.questions.length;
        
        document.getElementById('btn-begin').onclick = app.startQuizFlow;
        app.showView('view-start');
    },

    startQuizFlow: () => {
        app.showView('view-quiz');
        app.renderQuestionNav();
        // Render immediately without animation for the first question
        app.renderCurrentQuestion(false); 
    },

    // NEW: Function to handle transitions
    changeQuestion: (direction) => {
        if (app.data.isAnimating) return; // Stop double clicks
        
        const newIndex = app.data.currentQuestionIndex + direction;
        const total = app.data.currentQuiz.questions.length;
        
        // Bounds check
        if (newIndex < 0 || newIndex >= total) return;

        app.data.isAnimating = true;

        // 1. Add Fade Out class
        const wrapper = document.getElementById('q-anim-wrapper');
        wrapper.classList.add('fade-out');

        // 2. Wait for CSS transition (300ms)
        setTimeout(() => {
            // 3. Update Data
            app.data.currentQuestionIndex = newIndex;
            
            // 4. Render new content (invisible)
            app.renderCurrentQuestion(true); // true = keep hidden initially
            
            // 5. Scroll to top of question (optional, good for mobile)
            // document.querySelector('.question-card').scrollIntoView({ behavior: 'smooth' });

            // 6. Remove Fade Out (triggers Fade In because of CSS transition default)
            // We use a tiny timeout to ensure DOM updated before removing class
            requestAnimationFrame(() => {
                wrapper.classList.remove('fade-out');
                
                // Unlock after fade in completes
                setTimeout(() => {
                    app.data.isAnimating = false;
                }, 300);
            });

        }, 300);
    },

    renderQuestionNav: () => {
        const map = document.getElementById('question-nav-map');
        map.innerHTML = '';
        app.data.currentQuiz.questions.forEach((q, idx) => {
            const btn = document.createElement('div');
            btn.className = 'nav-btn';
            btn.innerText = idx + 1;
            btn.id = `nav-${idx}`;
            btn.onclick = () => {
                // Custom logic for nav buttons to use transition
                if (idx !== app.data.currentQuestionIndex && !app.data.isAnimating) {
                    // Calculate direction for context (optional, or just reuse fade)
                    app.data.isAnimating = true;
                    document.getElementById('q-anim-wrapper').classList.add('fade-out');
                    setTimeout(() => {
                        app.data.currentQuestionIndex = idx;
                        app.renderCurrentQuestion(true);
                        requestAnimationFrame(() => {
                            document.getElementById('q-anim-wrapper').classList.remove('fade-out');
                            setTimeout(() => { app.data.isAnimating = false; }, 300);
                        });
                    }, 300);
                }
            };
            map.appendChild(btn);
        });
        app.updateNavStyles();
    },

    updateNavStyles: () => {
        document.querySelectorAll('.nav-btn').forEach((btn, idx) => {
            btn.classList.remove('active');
            if (idx === app.data.currentQuestionIndex) btn.classList.add('active');
            
            const ans = app.data.userAnswers[idx];
            let isAnswered = false;
            if (Array.isArray(ans)) isAnswered = ans.length > 0;
            else isAnswered = ans !== undefined;

            if (isAnswered) btn.classList.add('answered');
        });
        
        const total = app.data.currentQuiz.questions.length;
        let answeredCount = 0;
        Object.values(app.data.userAnswers).forEach(v => {
            if(Array.isArray(v) && v.length > 0) answeredCount++;
            else if(!Array.isArray(v) && v !== undefined) answeredCount++;
        });

        const pct = (answeredCount / total) * 100;
        document.getElementById('progress-fill').style.width = `${pct}%`;
        document.getElementById('progress-text').innerText = `Question ${app.data.currentQuestionIndex + 1} of ${total}`;
    },

    renderCurrentQuestion: (skipNavUpdate = false) => {
        const qIndex = app.data.currentQuestionIndex;
        const qData = app.data.currentQuiz.questions[qIndex];
        
        // 1. DEFINE CONTAINERS EARLY
        const optsContainer = document.getElementById('q-options');
        optsContainer.innerHTML = ''; // Clear previous content immediately

        // 2. BASIC TEXT
        document.getElementById('q-number').innerText = `Question ${qIndex + 1}`;
        document.getElementById('q-text').innerText = qData.question;
        document.getElementById('quiz-title-display').innerText = app.data.currentQuiz.title;

        // 3. IMAGE LOGIC
        const imgEl = document.getElementById('q-image');
        if (qData.image) {
            const imgSrc = qData.image.startsWith('http') ? qData.image : `quizzes/images/${qData.image}`;
            imgEl.src = imgSrc;
            imgEl.classList.remove('hidden');
        } else {
            imgEl.classList.add('hidden');
            imgEl.src = ''; 
        }

        // 4. INSTRUCTION & RENDERING LOGIC
        const instructionEl = document.getElementById('q-instruction');
        
        // --- CASE A: MATCHING QUESTION ---
        if (qData.type === 'match') {
            instructionEl.innerText = "(Tap an answer in the bank to fill a slot. Tap a slot to clear it.)";
            
            // Create Container
            const matchContainer = document.createElement('div');
            matchContainer.className = 'match-container';

            // Get Current Answers
            const currentAns = app.data.userAnswers[qIndex] || {};

            // Render Rows
            qData.pairs.forEach((pair, idx) => {
                const row = document.createElement('div');
                row.className = 'match-row';
                
                const prompt = document.createElement('div');
                prompt.className = 'match-prompt';
                prompt.innerText = pair.left;
                
                const slot = document.createElement('div');
                slot.className = 'match-slot';
                slot.dataset.slotIndex = idx;
                
                if (currentAns[idx]) {
                    slot.innerText = currentAns[idx];
                    slot.classList.add('filled');
                } else {
                    slot.innerText = "Drop here...";
                }

                slot.onclick = () => app.handleMatchSlotClick(qIndex, idx);

                row.appendChild(prompt);
                row.appendChild(slot);
                matchContainer.appendChild(row);
            });
            
            optsContainer.appendChild(matchContainer);

            // Create Bank
            const bank = document.createElement('div');
            bank.className = 'match-bank';
            
            let allOptions = qData.pairs.map(p => p.right);
            const usedOptions = Object.values(currentAns);
            const availableOptions = allOptions.filter(opt => !usedOptions.includes(opt));
            
            availableOptions.sort(() => 0.5 - Math.random());

            availableOptions.forEach(optText => {
                const chip = document.createElement('div');
                chip.className = 'match-option-chip';
                chip.innerText = optText;
                chip.onclick = () => app.handleMatchBankClick(qIndex, optText);
                bank.appendChild(chip);
            });

            optsContainer.appendChild(bank);
            
            // DO NOT RETURN HERE! We need to run the button logic below.
        } 
        // --- CASE A : NEW DROPDOWN MATCHING LOGIC ---
        else if (qData.type === 'dropdown-match') {
            instructionEl.innerText = "(Select the correct option from the dropdown menu for each item.)";
            
            const ddContainer = document.createElement('div');
            
            // 1. Get all unique options for the dropdowns (from the 'right' side of pairs)
            // We use a Set to remove duplicates, then sort them
            const uniqueOptions = [...new Set(qData.pairs.map(p => p.right))].sort();

            // 2. Get current user answers object { 0: "Answer A", 1: "Answer B" }
            const currentAns = app.data.userAnswers[qIndex] || {};

            // 3. Build rows
            qData.pairs.forEach((pair, idx) => {
                const row = document.createElement('div');
                row.className = 'dd-match-row';

                // Prompt Text
                const prompt = document.createElement('div');
                prompt.className = 'dd-match-prompt';
                prompt.innerText = pair.left;

                // Select Menu
                const select = document.createElement('select');
                select.className = 'dd-match-select';
                
                // Add Default "Select an option"
                const defaultOpt = document.createElement('option');
                defaultOpt.value = "";
                defaultOpt.innerText = "Please select an option";
                defaultOpt.disabled = true;
                if (!currentAns[idx]) defaultOpt.selected = true;
                select.appendChild(defaultOpt);

                // Add Actual Options
                uniqueOptions.forEach(optText => {
                    const option = document.createElement('option');
                    option.value = optText;
                    option.innerText = optText;
                    if (currentAns[idx] === optText) option.selected = true;
                    select.appendChild(option);
                });

                // Event Listener
                select.onchange = (e) => {
                    let answers = app.data.userAnswers[qIndex] || {};
                    answers[idx] = e.target.value;
                    app.data.userAnswers[qIndex] = answers;
                    app.updateNavStyles(); // Update progress bar
                };

                row.appendChild(prompt);
                row.appendChild(select);
                ddContainer.appendChild(row);
            });

            optsContainer.appendChild(ddContainer);
        }
        
        // --- CASE C: STANDARD QUESTION (Single/Multiple) ---
        else {
            const isMultiple = qData.type === 'multiple';
            instructionEl.innerText = isMultiple ? "(Select all that apply)" : "(Select one)";

            qData.options.forEach((opt, optIdx) => {
                const el = document.createElement('div');
                el.className = 'option-item';
                if (isMultiple) el.classList.add('multi');

                const currentAns = app.data.userAnswers[qIndex];
                let isSelected = false;
                if (isMultiple) {
                    isSelected = Array.isArray(currentAns) && currentAns.includes(optIdx);
                } else {
                    isSelected = currentAns === optIdx;
                }

                if (isSelected) el.classList.add('selected');
                
                el.innerHTML = `<span class="opt-marker"></span> <span>${opt.text}</span>`;
                el.onclick = () => app.handleOptionClick(qIndex, optIdx, isMultiple);
                
                optsContainer.appendChild(el);
            });
        }

        // 5. UPDATE BUTTONS (Runs for ALL types now)
        const total = app.data.currentQuiz.questions.length;
        document.getElementById('btn-prev').disabled = qIndex === 0;
        
        const nextBtn = document.getElementById('btn-next');
        const finishBtn = document.getElementById('btn-finish');
        
        if (qIndex === total - 1) {
            nextBtn.classList.add('hidden');
            finishBtn.classList.remove('hidden');
            finishBtn.onclick = app.finishQuiz;
        } else {
            nextBtn.classList.remove('hidden');
            finishBtn.classList.add('hidden');
            nextBtn.onclick = () => app.changeQuestion(1);
        }
        
        document.getElementById('btn-prev').onclick = () => app.changeQuestion(-1);

        app.updateNavStyles();
    },

    handleOptionClick: (qIndex, optIndex, isMultiple) => {
        if (isMultiple) {
            let current = app.data.userAnswers[qIndex] || [];
            if (!Array.isArray(current)) current = [];
            const pos = current.indexOf(optIndex);
            if (pos === -1) current.push(optIndex);
            else current.splice(pos, 1);
            app.data.userAnswers[qIndex] = current;
        } else {
            app.data.userAnswers[qIndex] = optIndex;
        }
        // Re-render visual selection ONLY (avoid full transition)
        app.renderCurrentQuestion(true); 
    },

    finishQuiz: () => {
        const total = app.data.currentQuiz.questions.length;
        let correctCount = 0;

        app.data.currentQuiz.questions.forEach((q, idx) => {
            const userAns = app.data.userAnswers[idx];

            if (q.type === 'match' || q.type === 'dropdown-match') {
                // LOGIC IS IDENTICAL FOR BOTH MATCHING TYPES
                if (userAns) {
                    let allCorrect = true;
                    // Check every pair defined in JSON
                    q.pairs.forEach((pair, pairIdx) => {
                        // User answer for this slot vs Real answer
                        if (userAns[pairIdx] !== pair.right) {
                            allCorrect = false;
                        }
                    });
                    
                    // Also ensure all slots are filled
                    const filledCount = Object.keys(userAns).length;
                    if (filledCount !== q.pairs.length) allCorrect = false;

                    if (allCorrect) correctCount++;
                }
            } 
            else if (q.type === 'multiple') {
                // ... (Existing multiple logic) ...
                const correctIndices = q.options.map((opt, i) => opt.isCorrect ? i : -1).filter(i => i !== -1);
                const userIndices = Array.isArray(userAns) ? userAns : [];
                const isCorrect = correctIndices.length === userIndices.length && correctIndices.every(val => userIndices.includes(val));
                if (isCorrect) correctCount++;
            } 
            else {
                // ... (Existing single logic) ...
                if (userAns !== undefined && q.options[userAns].isCorrect) {
                    correctCount++;
                }
            }
        });

        const score = Math.round((correctCount / total) * 100);
        const pass = app.data.currentQuiz.passPercentage || 70;
        
        const scoreEl = document.getElementById('result-score');
        const msgEl = document.getElementById('result-msg');
        
        scoreEl.innerText = `${score}%`;
        if (score >= pass) {
            scoreEl.className = 'pass';
            msgEl.innerText = "Congratulations! You successfully passed.";
        } else {
            scoreEl.className = 'fail';
            msgEl.innerText = "You did not pass. Keep practicing.";
        }

        if (app.data.currentQuiz.type === 'custom') {
            document.getElementById('btn-save-custom').classList.remove('hidden');
        } else {
            document.getElementById('btn-save-custom').classList.add('hidden');
        }

        app.showView('view-result');
    },
    
    // ... [Rest of code: resetQuiz, startReview, renderCustomBuilder, generateCustomQuiz, saveCustomQuiz] ...
    resetQuiz: () => { app.loadInMemoryQuiz(app.data.currentQuiz); },

    startReview: () => {
        const container = document.getElementById('review-container');
        container.innerHTML = '';

        app.data.currentQuiz.questions.forEach((q, idx) => {
            const userAns = app.data.userAnswers[idx];
            
            const item = document.createElement('div');
            item.className = 'review-item';
            
            let html = `<h4>${idx + 1}. ${q.question}</h4>`;

            if (q.type === 'match') {
                // Render Table-like review for matches
                html += `<div style="background:#f9f9f9; padding:10px; border-radius:4px;">`;
                q.pairs.forEach((pair, pairIdx) => {
                    const userVal = userAns ? userAns[pairIdx] : "No Answer";
                    const isCorrect = userVal === pair.right;
                    
                    html += `
                    <div class="match-review-row">
                        <span>${pair.left}</span>
                        <div style="text-align:right">
                            ${isCorrect 
                                ? `<span class="match-review-correct">${pair.right}</span>` 
                                : `<span class="match-review-wrong">${userVal}</span> <br> <small style="color:green">Correct: ${pair.right}</small>`
                            }
                        </div>
                    </div>`;
                });
                html += `</div>`;
            } else if (q.type === 'dropdown-match') {
                // --- NEW REVIEW FOR DROPDOWN ---
                html += `<div style="background:#fff; border:1px solid #eee; border-radius:4px;">`;
                q.pairs.forEach((pair, pairIdx) => {
                    const userVal = userAns ? userAns[pairIdx] : "No Answer";
                    const isCorrect = userVal === pair.right;
                    
                    html += `
                    <div class="dd-review-row">
                        <div style="margin-bottom:5px;"><strong>${pair.left}</strong></div>
                        <div>
                            ${isCorrect 
                                ? `<span class="dd-correct">✔ ${userVal}</span>` 
                                : `<span class="dd-wrong">${userVal}</span> <span class="dd-correct">➝ ${pair.right}</span>`
                            }
                        </div>
                    </div>`;
                });
                html += `</div>`;
            } else {
                // ... (Existing Review logic for single/multiple) ...
                q.options.forEach((opt, optIdx) => {
                    const isMultiple = q.type === 'multiple';
                    let classes = 'review-opt';
                    let marker = '';
                    let userSelected = false;
                    
                    if (isMultiple) userSelected = Array.isArray(userAns) && userAns.includes(optIdx);
                    else userSelected = userAns === optIdx;

                    if (opt.isCorrect) classes += ' correct';
                    if (userSelected && !opt.isCorrect) classes += ' wrong';
                    if (userSelected) marker = ' <strong>(Your Answer)</strong>';
                    
                    html += `<div class="${classes}">${opt.text} ${marker}</div>`;
                });
            }

            if (q.explanation) {
                html += `<div class="explanation"><strong>Explanation:</strong> ${q.explanation}</div>`;
            }

            item.innerHTML = html;
            container.appendChild(item);
        });

        app.showView('view-review');
    },

    renderCustomBuilder: () => {
        const list = document.getElementById('builder-module-list');
        list.innerHTML = '';
        app.data.manifest.modules.forEach(m => {
            const label = document.createElement('label');
            label.className = 'cb-item';
            label.innerHTML = `<input type="checkbox" value="${m.id}" class="mod-cb"> ${m.title}`;
            list.appendChild(label);
        });
    },

    generateCustomQuiz: async () => {
        const selected = Array.from(document.querySelectorAll('.mod-cb:checked')).map(cb => cb.value);
        if (selected.length === 0) { alert("Please select at least one module."); return; }
        const count = parseInt(document.getElementById('custom-count').value) || 20;
        const title = document.getElementById('custom-title').value || "Custom Quiz";
        let pool = [];
        for (const modId of selected) {
            const m = app.data.manifest.modules.find(x => x.id === modId);
            try {
                const data = await app.fetchJson(m.file);
                if(data.questions) pool = pool.concat(data.questions);
            } catch(e) { console.error(e); }
        }
        pool.sort(() => 0.5 - Math.random());
        const finalQuestions = pool.slice(0, count);
        const customQuiz = { id: 'custom-' + Date.now(), type: 'custom', title: title, passPercentage: 70, questions: finalQuestions, createdFrom: selected };
        app.loadInMemoryQuiz(customQuiz);
    },

    saveCustomQuiz: () => {
        const quiz = app.data.currentQuiz;
        if (quiz.type !== 'custom') return;
        const saved = JSON.parse(localStorage.getItem('customQuizzes') || '[]');
        saved.push(quiz);
        localStorage.setItem('customQuizzes', JSON.stringify(saved));
        alert("Quiz saved!");
        app.renderSavedCustom();
    },

    // --- Matching Logic Handlers ---
    
    // User clicks an item in the bank -> moves to first empty slot
    handleMatchBankClick: (qIndex, answerText) => {
        let current = app.data.userAnswers[qIndex] || {};
        const qData = app.data.currentQuiz.questions[qIndex];
        
        // Find first empty slot index
        let targetSlot = -1;
        for(let i=0; i<qData.pairs.length; i++) {
            if(!current[i]) {
                targetSlot = i;
                break;
            }
        }

        if (targetSlot !== -1) {
            current[targetSlot] = answerText;
            app.data.userAnswers[qIndex] = current;
            app.renderCurrentQuestion(true); // Re-render to update UI
        }
    },

    // User clicks a filled slot -> removes item, returns to bank
    handleMatchSlotClick: (qIndex, slotIndex) => {
        let current = app.data.userAnswers[qIndex];
        if (current && current[slotIndex]) {
            delete current[slotIndex]; // Remove answer
            app.data.userAnswers[qIndex] = current;
            app.renderCurrentQuestion(true); // Re-render
        }
    },

};

window.onload = app.init;