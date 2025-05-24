import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useDispatch, useSelector } from 'react-redux';
import { Provider } from 'react-redux';
import { createStore, combineReducers } from 'redux';

// Import the new LogViewer component (assuming it exists in the same directory)
import LogViewer from './LogViewer';

// --- Utility Functions ---
// Helper to convert DD-MM-YYYY to YYYY-MM-DD for <input type="date"> value
const convertDdMmYyyyToYyyyMmDd = (dateString) => {
    if (!dateString || dateString === 'N/A') return '';
    const parts = dateString.split('-');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateString; // Return as is if format is unexpected
};

// Helper to clean and format time (e.g., "7pm" to "19:00")
const formatTimeForInput = (timeString) => {
    if (!timeString || timeString === 'N/A') {
        return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    let cleanedTime = timeString.toLowerCase().replace(/\s/g, ''); // Remove spaces
    // Remove any leading/trailing asterisks that might have slipped through
    cleanedTime = cleanedTime.replace(/^\*\*|\*\*$/g, '');

    if (cleanedTime.endsWith('am')) {
        let hour = parseInt(cleanedTime.replace('am', ''), 10);
        if (hour === 12) hour = 0; // 12am is 00:00
        return `${String(hour).padStart(2, '0')}:00`;
    } else if (cleanedTime.endsWith('pm')) {
        let hour = parseInt(cleanedTime.replace('pm', ''), 10);
        if (hour !== 12) hour += 12; // Add 12 for pm hours except 12pm
        return `${String(hour).padStart(2, '0')}:00`;
    } else if (cleanedTime.match(/^\d{1,2}(:\d{2})?$/)) {
        // Already like HH or HH:MM
        const parts = cleanedTime.split(':');
        const hour = String(parseInt(parts[0], 10)).padStart(2, '0');
        const minute = parts[1] ? String(parseInt(parts[1], 10)).padStart(2, '0') : '00';
        return `${hour}:${minute}`;
    }
    return timeString; // Fallback
};

// --- Redux Reducers ---
const initialFormState = {
    hcpName: '',
    interactionDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
    interactionTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }), // HH:MM
    interactionType: 'Meeting',
    attendees: [],
    topicsDiscussed: '',
    materialsShared: [],
    samplesDistributed: [],
    hcpSentiment: '',
    outcomes: '',
    followUpActions: '',
};

const formReducer = (state = initialFormState, action) => {
    switch (action.type) {
        case 'UPDATE_FORM_FIELD':
            return {
                ...state,
                [action.payload.field]: action.payload.value,
            };
        case 'ADD_TO_LIST':
            const currentList = Array.isArray(state[action.payload.field]) ? state[action.payload.field] : [];
            return {
                ...state,
                [action.payload.field]: [...currentList, action.payload.value],
            };
        case 'REMOVE_FROM_LIST':
            return {
                ...state,
                [action.payload.field]: state[action.payload.field].filter((_, i) => i !== action.payload.index),
            };
        case 'RESET_FORM':
            return initialFormState;
        case 'POPULATE_FORM_FROM_DRAFT':
            console.log('FORM_REDUCER: POPULATE_FORM_FROM_DRAFT action received.');
            console.log('FORM_REDUCER: Payload:', action.payload);
            const newState = {
                ...state,
                ...action.payload,
                // Ensure date is in YYYY-MM-DD for the date input
                interactionDate: action.payload.interactionDate
                    ? convertDdMmYyyyToYyyyMmDd(action.payload.interactionDate)
                    : initialFormState.interactionDate,
                // Ensure time is in HH:MM for the time input
                interactionTime: action.payload.interactionTime
                    ? formatTimeForInput(action.payload.interactionTime)
                    : initialFormState.interactionTime,
            };
            console.log('FORM_REDUCER: New State:', newState);
            return newState;
        default:
            return state;
    }
};

const initialChatState = {
    messages: [],
    isLoading: false,
    error: null,
};

const chatReducer = (state = initialChatState, action) => {
    switch (action.type) {
        case 'ADD_MESSAGE':
            return {
                ...state,
                messages: [...state.messages, action.payload],
            };
        case 'SET_LOADING':
            return {
                ...state,
                isLoading: action.payload,
            };
        case 'SET_ERROR':
            return {
                ...state,
                error: action.payload,
            };
        case 'CLEAR_CHAT':
            return initialChatState;
        case 'UPDATE_LAST_MESSAGE':
            const updatedMessages = [...state.messages];
            if (updatedMessages.length > 0) {
                updatedMessages[updatedMessages.length - 1] = {
                    ...updatedMessages[updatedMessages.length - 1],
                    ...action.payload,
                };
            }
            return {
                ...state,
                messages: updatedMessages,
            };
        default:
            return state;
    }
};

const rootReducer = combineReducers({
    form: formReducer,
    chat: chatReducer,
});

const store = createStore(rootReducer);

// --- Reusable Components ---
const InputField = ({ label, type = 'text', value, onChange, placeholder = '' }) => (
    <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>{label}:</label>
        <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                boxSizing: 'border-box',
                fontFamily: 'Inter, sans-serif',
            }}
        />
    </div>
);

const TextAreaField = ({ label, value, onChange, placeholder = '' }) => (
    <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>{label}:</label>
        <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows="4"
            style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                boxSizing: 'border-box',
                fontFamily: 'Inter, sans-serif',
            }}
        />
    </div>
);

const SelectField = ({ label, value, onChange, options }) => (
    <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>{label}:</label>
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                boxSizing: 'border-box',
                fontFamily: 'Inter, sans-serif',
            }}
        >
            {options.map((option) => (
                <option key={option} value={option}>
                    {option}
                </option>
            ))}
        </select>
    </div>
);

const ListInput = ({ label, items, onAddItem, onRemoveItem }) => {
    const [inputValue, setInputValue] = useState('');

    const handleAdd = () => {
        if (inputValue.trim()) {
            onAddItem(inputValue.trim());
            setInputValue('');
        }
    };

    return (
        <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>{label}:</label>
            <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={`Add ${label.toLowerCase()}...`}
                    onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                            handleAdd();
                        }
                    }}
                    style={{
                        flexGrow: 1,
                        padding: '10px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        fontFamily: 'Inter, sans-serif',
                    }}
                />
                <button
                    onClick={handleAdd}
                    style={{
                        padding: '10px 15px',
                        backgroundColor: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontFamily: 'Inter, sans-serif',
                    }}
                >
                    Add
                </button>
            </div>
            <ul style={{ listStyleType: 'none', padding: 0 }}>
                {items.map((item, index) => (
                    <li
                        key={index}
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 0',
                            borderBottom: '1px dashed #eee',
                        }}
                    >
                        {item}
                        <button
                            onClick={() => onRemoveItem(index)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#dc3545',
                                cursor: 'pointer',
                                fontSize: '1.2em',
                                fontFamily: 'Inter, sans-serif',
                            }}
                        >
                            &times;
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

// --- HCPInteractionForm Component ---
const HCPInteractionForm = () => {
    const dispatch = useDispatch();
    const formState = useSelector((state) => state.form);

    const updateField = (field, value) => {
        dispatch({ type: 'UPDATE_FORM_FIELD', payload: { field, value } });
    };

    const addToList = (field, value) => {
        dispatch({ type: 'ADD_TO_LIST', payload: { field, value } });
    };

    const removeFromList = (field, index) => {
        dispatch({ type: 'REMOVE_FROM_LIST', payload: { field, index } });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const dataToSend = {
                ...formState,
            };

            const response = await axios.post('http://localhost:8000/api/log_interaction/form', dataToSend);
            alert(response.data.message);
            dispatch({ type: 'RESET_FORM' }); // Reset form after successful submission
        } catch (error) {
            console.error('Error logging interaction:', error);
            alert(`Failed to log interaction: ${error.response?.data?.detail || error.message}`);
        }
    };

    return (
        <div style={{ padding: '20px', maxWidth: '600px', margin: 'auto', backgroundColor: '#f9f9f9', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', fontFamily: 'Inter, sans-serif' }}>
            <h2 style={{ textAlign: 'center', color: '#333', marginBottom: '25px' }}>Log HCP Interaction (Form)</h2>
            <form onSubmit={handleSubmit}>
                <InputField label="HCP Name" value={formState.hcpName} onChange={(val) => updateField('hcpName', val)} placeholder="Dr. John Doe" />
                <InputField label="Interaction Date" type="date" value={formState.interactionDate} onChange={(val) => updateField('interactionDate', val)} />
                <InputField label="Interaction Time" type="time" value={formState.interactionTime} onChange={(val) => updateField('interactionTime', val)} />
                <SelectField
                    label="Interaction Type"
                    value={formState.interactionType}
                    onChange={(val) => updateField('interactionType', val)}
                    options={['Meeting', 'Call', 'Email', 'Conference', 'Other']}
                />
                <ListInput
                    label="Attendees"
                    items={formState.attendees}
                    onAddItem={(val) => addToList('attendees', val)}
                    onRemoveItem={(index) => removeFromList('attendees', index)}
                />
                <TextAreaField label="Topics Discussed" value={formState.topicsDiscussed} onChange={(val) => updateField('topicsDiscussed', val)} placeholder="Key discussion points, medical inquiries..." />
                <ListInput
                    label="Materials Shared"
                    items={formState.materialsShared}
                    onAddItem={(val) => addToList('materialsShared', val)}
                    onRemoveItem={(index) => removeFromList('materialsShared', index)}
                />
                <ListInput
                    label="Samples Distributed"
                    items={formState.samplesDistributed}
                    onAddItem={(val) => addToList('samplesDistributed', val)}
                    onRemoveItem={(index) => removeFromList('samplesDistributed', index)}
                />
                <SelectField
                    label="HCP Sentiment"
                    value={formState.hcpSentiment}
                    onChange={(val) => updateField('hcpSentiment', val)}
                    options={['', 'Positive', 'Neutral', 'Negative']}
                />
                <TextAreaField label="Outcomes" value={formState.outcomes} onChange={(val) => updateField('outcomes', val)} placeholder="Agreements, decisions, next steps..." />
                <TextAreaField label="Follow-up Actions" value={formState.followUpActions} onChange={(val) => updateField('followUpActions', val)} placeholder="Planned follow-up tasks..." />

                <button
                    type="submit"
                    style={{
                        width: '100%',
                        padding: '12px 20px',
                        backgroundColor: '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '1em',
                        fontFamily: 'Inter, sans-serif',
                        marginTop: '20px',
                    }}
                >
                    Log Interaction
                </button>
            </form>
        </div>
    );
};

// --- ChatInterface Component ---
const ChatInterface = () => {
    const dispatch = useDispatch();
    const { messages, isLoading, error } = useSelector((state) => state.chat);
    const [inputMessage, setInputMessage] = useState('');

    const chatMessagesRef = useRef(null); // Use useRef for direct DOM access

    // Helper function to parse draft text into a structured object
    const parseDraftText = (draftText) => {
        const parsedData = {};
        draftText.split('\n').forEach(line => {
            const parts = line.split(':', 2);
            if (parts.length === 2) {
                const key = parts[0].replace(/\*\*/g, '').trim(); // Remove ** from key
                let value = parts[1].replace(/\*\*/g, '').trim(); // Remove ** from value too!

                // Normalize 'N/A' to an empty string for all fields if present
                if (value === 'N/A') {
                    value = '';
                }

                // Map AI's draft keys to frontend formState keys
                if (key === 'HCP') {
                    parsedData['hcpName'] = value;
                } else if (key === 'Date') {
                    parsedData['interactionDate'] = value;
                } else if (key === 'Time') {
                    parsedData['interactionTime'] = value;
                } else if (key === 'Type') {
                    parsedData['interactionType'] = value || 'Meeting'; // Default to 'Meeting' if empty
                } else if (key === 'Attendees') {
                    parsedData['attendees'] = value ? value.split(',').map(item => item.trim()).filter(item => item !== '') : [];
                } else if (key === 'Topics') {
                    parsedData['topicsDiscussed'] = value;
                } else if (key === 'Materials Shared') {
                    parsedData['materialsShared'] = value ? value.split(',').map(item => item.trim()).filter(item => item !== '') : [];
                } else if (key === 'Samples Distributed') {
                    parsedData['samplesDistributed'] = value ? value.split(',').map(item => item.trim()).filter(item => item !== '') : [];
                } else if (key === 'Sentiment') {
                    // **CRITICAL FIX HERE - Enhanced Sentiment Parsing**
                    const normalizedSentiment = value.toLowerCase();
                    if (normalizedSentiment.includes('positive')) {
                        parsedData['hcpSentiment'] = 'Positive';
                    } else if (normalizedSentiment.includes('negative')) {
                        parsedData['hcpSentiment'] = 'Negative';
                    } else if (normalizedSentiment.includes('neutral')) {
                        parsedData['hcpSentiment'] = 'Neutral';
                    } else {
                        parsedData['hcpSentiment'] = ''; // Default to empty if not recognized
                    }
                } else if (key === 'Outcomes') {
                    parsedData['outcomes'] = value;
                } else if (key === 'Follow-up') {
                    parsedData['followUpActions'] = value;
                }
            }
        });
        return parsedData;
    };

    useEffect(() => {
        // This useEffect is ONLY for scrolling chat messages
        if (chatMessagesRef.current) {
            chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
        }
    }, [messages]); // Dependency on messages, so it scrolls when new messages are added.

    const handleFillForm = (draftText) => {
        console.log('User clicked Fill Form. Parsing draft and dispatching POPULATE_FORM_FROM_DRAFT.');
        const parsedData = parseDraftText(draftText);
        dispatch({ type: 'POPULATE_FORM_FROM_DRAFT', payload: parsedData });
    };

    const handleConfirmDraft = async (draftText) => {
        console.log('User clicked Confirm Log. Parsing draft and sending to backend for database entry.');
        const parsedData = parseDraftText(draftText);

        const dataToSend = {
            hcpName: parsedData.hcpName,
            interactionDate: parsedData.interactionDate, // DD-MM-YYYY format expected by backend for chat_confirm
            interactionTime: formatTimeForInput(parsedData.interactionTime),
            interactionType: parsedData.interactionType,
            attendees: parsedData.attendees,
            topicsDiscussed: parsedData.topicsDiscussed,
            materialsShared: parsedData.materialsShared,
            samplesDistributed: parsedData.samplesDistributed,
            hcpSentiment: parsedData.hcpSentiment,
            outcomes: parsedData.outcomes,
            followUpActions: parsedData.followUpActions,
        };

        try {
            dispatch({ type: 'SET_LOADING', payload: true });
            const response = await axios.post('http://localhost:8000/api/log_interaction/chat_confirm', dataToSend);
            dispatch({ type: 'SET_LOADING', payload: false });

            // After confirming, simulate receiving suggestions from the AI
            dispatch({
                type: 'ADD_MESSAGE',
                payload: {
                    id: Date.now().toString() + '_conf',
                    text: response.data.message,
                    sender: 'ai',
                    type: 'text',
                },
            });

            // Simulate AI sending follow-up suggestions after successful log confirmation
            dispatch({
                type: 'ADD_MESSAGE',
                payload: {
                    id: Date.now().toString() + '_suggestions',
                    text: 'Here are some suggested follow-up actions:',
                    sender: 'ai',
                    type: 'suggestions',
                    suggestions: [
                        'Schedule a demo of Product X for Dr. [HCP Name]',
                        'Send "New Clinical Data for Product Y" to Dr. [HCP Name]',
                        'Arrange peer-to-peer discussion with Dr. [HCP Name] and Dr. Smith',
                    ],
                },
            });

            alert(response.data.message);
            dispatch({ type: 'CLEAR_CHAT' });
            dispatch({ type: 'RESET_FORM' });
        } catch (err) {
            console.error('Error confirming draft:', err);
            dispatch({ type: 'SET_LOADING', payload: false });
            dispatch({
                type: 'ADD_MESSAGE',
                payload: {
                    id: Date.now().toString() + '_error',
                    text: `Error confirming log: ${err.response?.data?.detail || err.message}`,
                    sender: 'ai',
                    type: 'error',
                },
            });
        }
    };

    const handleAddSuggestion = (suggestionText) => {
        // In a real app, this would dispatch an action to add to a task list, calendar, etc.
        console.log(`Adding suggestion to task list: "${suggestionText}"`);
        alert(`Suggestion added: "${suggestionText}" (Check console for full action)`);
        // You might want to update the UI to show the suggestion was acted upon, or remove it.
    };

    const handleSendMessage = async () => {
        if (!inputMessage.trim()) return;

        const userMessage = { id: Date.now().toString(), text: inputMessage, sender: 'user', type: 'text' };
        dispatch({ type: 'ADD_MESSAGE', payload: userMessage });
        dispatch({ type: 'SET_LOADING', payload: true });
        setInputMessage('');

        try {
            const response = await axios.post('http://localhost:8000/api/log_interaction/chat', {
                message: userMessage.text,
                history: messages,
            });

            const aiResponse = response.data;
            dispatch({
                type: 'ADD_MESSAGE',
                payload: {
                    id: aiResponse.id,
                    text: aiResponse.reply,
                    sender: 'ai',
                    type: aiResponse.type,
                },
            });
            dispatch({ type: 'SET_LOADING', payload: false });
        } catch (err) {
            console.error('Error sending chat message:', err);
            dispatch({ type: 'SET_ERROR', payload: 'Failed to get a response from the AI.' });
            dispatch({ type: 'SET_LOADING', payload: false });
            dispatch({
                type: 'ADD_MESSAGE',
                payload: {
                    id: Date.now().toString(),
                    text: `Error: ${err.response?.data?.detail || err.message}`,
                    sender: 'ai',
                    type: 'error',
                },
            });
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: '600px', margin: 'auto', backgroundColor: '#f9f9f9', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', fontFamily: 'Inter, sans-serif' }}>
            <h2 style={{ textAlign: 'center', color: '#333', padding: '15px', borderBottom: '1px solid #eee' }}>Conversational Chat</h2>
            {/* This is the chat messages container with the scrollbar */}
            <div
                ref={chatMessagesRef}
                style={{
                    flexGrow: 1,
                    padding: '20px',
                    overflowY: 'auto', /* This is the key for the scrollbar */
                    maxHeight: 'calc(100vh - 200px)', /* Adjust this value as needed */
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    flexShrink: 1, /* Allow it to shrink */
                }}
            >
                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        style={{
                            alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                            backgroundColor: msg.sender === 'user' ? '#dcf8c6' : (msg.type === 'draft' ? '#fff3cd' : (msg.type === 'suggestions' ? '#d4edda' : (msg.type === 'error' ? '#f8d7da' : '#e2e6ea'))),
                            color: msg.type === 'error' ? '#721c24' : (msg.type === 'suggestions' ? '#155724' : '#333'),
                            padding: '10px 15px',
                            borderRadius: '15px',
                            maxWidth: '80%',
                            wordBreak: 'break-word',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                            whiteSpace: 'pre-wrap',
                        }}
                    >
                        {msg.text}
                        {msg.type === 'draft' && (
                            <div style={{ marginTop: '10px', display: 'flex', gap: '5px' }}>
                                <button
                                    onClick={() => handleFillForm(msg.text)}
                                    style={{
                                        padding: '5px 10px',
                                        backgroundColor: '#17a2b8', // Info blue color
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '0.8em',
                                        marginRight: '5px',
                                    }}
                                >
                                    Fill Form
                                </button>
                                <button
                                    onClick={() => handleConfirmDraft(msg.text)}
                                    style={{
                                        padding: '5px 10px',
                                        backgroundColor: '#007bff',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '0.8em',
                                    }}
                                >
                                    Confirm Log
                                </button>
                            </div>
                        )}
                        {msg.type === 'suggestions' && msg.suggestions && msg.suggestions.length > 0 && (
                            <div style={{ marginTop: '10px', borderTop: '1px solid #c3e6cb', paddingTop: '10px' }}>
                                <p style={{ fontWeight: 'bold', marginBottom: '5px', color: '#155724' }}>Suggested Follow-ups:</p>
                                {msg.suggestions.map((suggestion, idx) => (
                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#e2f0d9', padding: '8px', borderRadius: '4px', marginBottom: '5px' }}>
                                        <span style={{ flexGrow: 1, marginRight: '10px', fontSize: '0.9em' }}>{suggestion}</span>
                                        <button
                                            onClick={() => handleAddSuggestion(suggestion)}
                                            style={{
                                                padding: '4px 8px',
                                                backgroundColor: '#28a745', // Success green
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '3px',
                                                cursor: 'pointer',
                                                fontSize: '0.75em',
                                            }}
                                        >
                                            Add
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
                {isLoading && (
                    <div style={{ alignSelf: 'flex-start', padding: '10px 15px', borderRadius: '15px', backgroundColor: '#e2e6ea', fontStyle: 'italic' }}>
                        AI is typing...
                    </div>
                )}
                {error && (
                    <div style={{ alignSelf: 'flex-start', padding: '10px 15px', borderRadius: '15px', backgroundColor: '#f8d7da', color: '#721c24' }}>
                        Error: {error}
                    </div>
                )}
            </div>
            <div style={{ padding: '15px', borderTop: '1px solid #eee', display: 'flex', gap: '10px', backgroundColor: '#fff' }}>
                <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                            handleSendMessage();
                        }
                    }}
                    placeholder="Type your message..."
                    style={{
                        flexGrow: 1,
                        padding: '10px',
                        border: '1px solid #ccc',
                        borderRadius: '20px',
                        fontFamily: 'Inter, sans-serif',
                    }}
                    disabled={isLoading}
                />
                <button
                    onClick={handleSendMessage}
                    style={{
                        padding: '10px 20px',
                        backgroundColor: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '20px',
                        cursor: 'pointer',
                        fontSize: '1em',
                        fontFamily: 'Inter, sans-serif',
                        opacity: isLoading ? 0.6 : 1,
                    }}
                    disabled={isLoading}
                >
                    Send
                </button>
            </div>
        </div>
    );
};

// --- Main App Component ---
const App = () => {
    // State to manage which page is currently displayed
    const [currentPage, setCurrentPage] = useState('main'); // 'main' or 'logs'

    return (
        <Provider store={store}>
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'Inter, sans-serif',
                height: '100vh', /* Ensure the main container takes full viewport height */
                backgroundColor: '#f0f2f5',
                padding: '20px',
                boxSizing: 'border-box',
                gap: '20px',
            }}>
                {/* Navigation Header */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px', gap: '10px' }}>
                    <button
                        onClick={() => setCurrentPage('main')}
                        style={{
                            padding: '10px 20px',
                            fontSize: '1em',
                            cursor: 'pointer',
                            backgroundColor: currentPage === 'main' ? '#007bff' : '#6c757d',
                            color: 'white',
                            border: 'none',
                            borderRadius: '5px',
                        }}
                    >
                        Log Interaction
                    </button>
                    <button
                        onClick={() => setCurrentPage('logs')}
                        style={{
                            padding: '10px 20px',
                            fontSize: '1em',
                            cursor: 'pointer',
                            backgroundColor: currentPage === 'logs' ? '#007bff' : '#6c757d',
                            color: 'white',
                            border: 'none',
                            borderRadius: '5px',
                        }}
                    >
                        View Logs
                    </button>
                </div>

                <div style={{ display: 'flex', flexGrow: 1, gap: '20px', justifyContent: 'center', alignItems: 'flex-start' }}>
                    {currentPage === 'main' && (
                        <>
                            <HCPInteractionForm />
                            <ChatInterface />
                        </>
                    )}
                    {currentPage === 'logs' && <LogViewer />}
                </div>
            </div>
        </Provider>
    );
};

export default App;