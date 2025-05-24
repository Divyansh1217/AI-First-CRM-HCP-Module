// frontend/src/LogViewer.js
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const LogViewer = () => {
    const [logs, setLogs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchLogs = async () => {
            try {
                setIsLoading(true);
                setError(null);
                const response = await axios.get('http://localhost:8000/api/logs');
                setLogs(response.data);
            } catch (err) {
                console.error('Error fetching logs:', err);
                setError(`Failed to load logs: ${err.response?.data?.detail || err.message}`);
            } finally {
                setIsLoading(false);
            }
        };

        fetchLogs();
    }, []);

    const formatList = (list) => {
        return Array.isArray(list) && list.length > 0 ? list.join(', ') : 'N/A';
    };

    return (
        <div style={{ padding: '20px', maxWidth: '1000px', margin: 'auto', backgroundColor: '#f9f9f9', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', fontFamily: 'Inter, sans-serif' }}>
            <h2 style={{ textAlign: 'center', color: '#333', marginBottom: '25px' }}>All Interaction Logs</h2>

            {isLoading && <p style={{ textAlign: 'center' }}>Loading logs...</p>}
            {error && <p style={{ textAlign: 'center', color: 'red' }}>{error}</p>}

            {!isLoading && logs.length === 0 && !error && (
                <p style={{ textAlign: 'center' }}>No logs found. Start by logging an interaction!</p>
            )}

            {!isLoading && logs.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#e2e6ea' }}>
                                <th style={tableHeaderStyle}>ID</th>
                                <th style={tableHeaderStyle}>HCP Name</th>
                                <th style={tableHeaderStyle}>Date</th>
                                <th style={tableHeaderStyle}>Time</th>
                                <th style={tableHeaderStyle}>Type</th>
                                <th style={tableHeaderStyle}>Topics</th>
                                <th style={tableHeaderStyle}>Sentiment</th>
                                <th style={tableHeaderStyle}>Materials</th>
                                <th style={tableHeaderStyle}>Samples</th>
                                <th style={tableHeaderStyle}>Outcomes</th>
                                <th style={tableHeaderStyle}>Follow-up</th>
                                <th style={tableHeaderStyle}>Logged At</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map((log) => (
                                <tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={tableCellStyle}>{log.id}</td>
                                    <td style={tableCellStyle}>{log.hcpName}</td>
                                    <td style={tableCellStyle}>{log.interactionDate}</td>
                                    <td style={tableCellStyle}>{log.interactionTime || 'N/A'}</td>
                                    <td style={tableCellStyle}>{log.interactionType}</td>
                                    <td style={tableCellStyle}>{log.topicsDiscussed}</td>
                                    <td style={tableCellStyle}>{log.hcpSentiment || 'N/A'}</td>
                                    <td style={tableCellStyle}>{formatList(log.materialsShared)}</td>
                                    <td style={tableCellStyle}>{formatList(log.samplesDistributed)}</td>
                                    <td style={tableCellStyle}>{log.outcomes || 'N/A'}</td>
                                    <td style={tableCellStyle}>{log.followUpActions || 'N/A'}</td>
                                    <td style={tableCellStyle}>{new Date(log.timestamp).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// Basic inline styles for table
const tableHeaderStyle = {
    padding: '12px 15px',
    textAlign: 'left',
    borderBottom: '1px solid #ccc',
    fontWeight: 'bold',
    fontSize: '0.9em',
};

const tableCellStyle = {
    padding: '10px 15px',
    textAlign: 'left',
    borderBottom: '1px solid #eee',
    fontSize: '0.85em',
};

export default LogViewer;